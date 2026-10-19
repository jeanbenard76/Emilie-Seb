/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import {
  initDatabase,
  getAllFamiliesWithMembers,
  searchFamilies,
  submitRSVP,
  getStats,
  getAllRSVPs,
  getDbFilePath,
  saveDatabaseToDisk,
  updateFamilyInvitations,
  clearAllRSVPs,
  addFamilies,
  deleteFamily,
  updateFamily,
  updateFamilyHost,
  addContactMessage,
  getAllContactMessages,
  clearAllContactMessages,
} from "./server/db";
import {
  sendRSVPNotificationEmail,
  sendContactNotificationEmail,
  sendHostRecapEmails,
  generateHostRecapExcel,
} from "./server/mailer";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const IS_PROD = process.env.NODE_ENV === "production";
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  const ADMIN_FULL_TOKEN = process.env.ADMIN_FULL_TOKEN;

  app.use(express.json());

  // Initialize SQLite wedding.db database
  await initDatabase();

  // Helper to determine admin access level
  const getAdminAccess = (provided: unknown): { authed: boolean; isFull: boolean } => {
    // If in development mode and neither token is set, grant full access
    if (!ADMIN_TOKEN && !ADMIN_FULL_TOKEN) {
      if (IS_PROD) return { authed: false, isFull: false };
      return { authed: true, isFull: true };
    }

    if (typeof provided !== "string" || !provided.trim()) {
      return { authed: false, isFull: false };
    }

    const token = provided.trim();

    // 1. Super / Full Admin token (can see optional words & private messages)
    if (ADMIN_FULL_TOKEN && token === ADMIN_FULL_TOKEN) {
      return { authed: true, isFull: true };
    }

    // 2. Standard / Restricted Admin token (hides optional words)
    if (ADMIN_TOKEN && token === ADMIN_TOKEN) {
      return { authed: true, isFull: false };
    }

    return { authed: false, isFull: false };
  };

  // Protect sensitive routes (guest data & destructive actions) with ADMIN_TOKEN or ADMIN_FULL_TOKEN.
  // Token accepted via "x-admin-token" header or "?key=" query param (for download links).
  const requireAdmin: express.RequestHandler = (req, res, next) => {
    if (!ADMIN_TOKEN && !ADMIN_FULL_TOKEN && IS_PROD) {
      return res.status(503).json({
        error: "ADMIN_TOKEN / ADMIN_FULL_TOKEN non configurés sur le serveur : accès admin désactivé.",
      });
    }

    const provided = (req.headers["x-admin-token"] || req.query.key) as string | undefined;
    const access = getAdminAccess(provided);

    if (access.authed) {
      (req as any).isAdminFull = access.isFull;
      return next();
    }

    res.status(401).json({ error: "Accès non autorisé." });
  };

  // Basic in-memory rate limit on RSVP & contact form submissions (anti-spam)
  const rsvpHits = new Map<string, number[]>();
  const rsvpRateLimit: express.RequestHandler = (req, res, next) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const hits = (rsvpHits.get(ip) || []).filter((t) => now - t < windowMs);
    if (hits.length >= 10) {
      return res.status(429).json({ error: "Trop de tentatives, réessayez dans quelques minutes." });
    }
    hits.push(now);
    rsvpHits.set(ip, hits);
    next();
  };

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", db: "wedding.db active" });
  });

  // Verify admin password (used by the dashboard login popup)
  app.get("/api/admin/verify", requireAdmin, (req, res) => {
    const isFull = Boolean((req as any).isAdminFull);
    res.json({ ok: true, canSeeOptionalNotes: isFull });
  });

  // Get all families or search by query
  app.get("/api/families", (req, res) => {
    try {
      const provided = (req.headers["x-admin-token"] || req.query.key) as string | undefined;
      const access = getAdminAccess(provided);

      const { q } = req.query;
      let families = typeof q === "string" && q.trim()
        ? searchFamilies(q)
        : getAllFamiliesWithMembers();

      // Si l'utilisateur n'a pas accès complet, on masque le mot optionnel (lastMessage)
      if (!access.isFull) {
        families = families.map((fam: any) => ({
          ...fam,
          lastMessage: "",
        }));
      }

      res.json(families);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Submit RSVP and save to SQLite wedding.db + transmit email to valentinetjean@etik.com
  app.post("/api/rsvp", rsvpRateLimit, async (req, res) => {
  try {
    const { familyId, familyName, email, message, members } = req.body;
    if (!familyName || !Array.isArray(members)) {
      return res
        .status(400)
        .json({ error: "Champs requis manquants (familyName, members)" });
    }
    const safeEmail = typeof email === 'string' ? email.trim() : '';
    const result = submitRSVP({ familyId, familyName, email: safeEmail, message, members });

    // Transmit response notification email to valentinetjean@etik.com
    sendRSVPNotificationEmail({ familyName, email: safeEmail, message, members }).catch((err) => {
      console.error("Erreur envoi notification email RSVP:", err);
    });

    res.json({
      success: true,
      message: "Réponse enregistrée avec succès et transmise à valentinetjean@etik.com !",
      result,
    });
  } catch (err: any) {
    console.error("Erreur enregistrement RSVP dans wedding.db:", err);
    res.status(500).json({ error: err.message });
  }
});

  // Contact form: messages are saved in wedding.db and read by the couple in the admin dashboard
  // (no email service configured on the server).
  app.post("/api/contact", rsvpRateLimit, (req, res) => {
    try {
      const { nom, email, sujet, message, website } = req.body || {};
      if (website) {
        return res.status(400).json({ status: "error", message: "Spam détecté." });
      }
      const name = typeof nom === "string" ? nom.trim() : "";
      const mail = typeof email === "string" ? email.trim() : "";
      const text = typeof message === "string" ? message.trim() : "";
      const subject = typeof sujet === "string" ? sujet.trim().slice(0, 50) : "";
      if (!name || !text || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
        return res
          .status(400)
          .json({ status: "error", message: "Veuillez remplir tous les champs correctement." });
      }
      if (name.length > 200 || mail.length > 200 || text.length > 5000) {
        return res.status(400).json({ status: "error", message: "Message trop long." });
      }
      addContactMessage({ name, email: mail, subject, message: text });

      // Transmit contact notification email to valentinetjean@etik.com
      sendContactNotificationEmail({ name, email: mail, subject, message: text }).catch((err) => {
        console.error("Erreur envoi notification email contact:", err);
      });

      res.json({ status: "success", message: "Message envoyé avec succès." });
    } catch (err: any) {
      console.error("Erreur enregistrement message de contact dans wedding.db:", err);
      res.status(500).json({ status: "error", message: "Une erreur est survenue lors de l'envoi." });
    }
  });

  // Update invitation scopes (Vin / Repas / Brunch) for a family
  app.post("/api/admin/update-invitation", requireAdmin, (req, res) => {
    try {
      const { familyId, invitedVin, invitedRepas, invitedBrunch } = req.body;
      if (!familyId) {
        return res.status(400).json({ error: "familyId requis" });
      }
      const result = updateFamilyInvitations(
        familyId,
        Boolean(invitedVin),
        Boolean(invitedRepas),
        Boolean(invitedBrunch)
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clear all RSVPs and reset database responses
  app.post("/api/admin/clear-rsvps", requireAdmin, (req, res) => {
    try {
      const result = clearAllRSVPs();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Add new families (manual or bulk import)
  app.post("/api/admin/families", requireAdmin, (req, res) => {
    try {
      const families = req.body;
      if (!Array.isArray(families)) {
        return res.status(400).json({ error: "Un tableau de familles est requis" });
      }
      const result = addFamilies(families);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update a family
  app.put("/api/admin/families/:id", requireAdmin, (req, res) => {
    try {
      const familyId = req.params.id;
      if (!familyId) return res.status(400).json({ error: "L'ID de la famille est requis" });
      const result = updateFamily(familyId, req.body);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a family
  app.delete("/api/admin/families/:id", requireAdmin, (req, res) => {
    try {
      const familyId = req.params.id;
      if (!familyId) return res.status(400).json({ error: "L'ID de la famille est requis" });
      const result = deleteFamily(familyId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update host (who invited) for a family
  app.post("/api/admin/update-family-host", requireAdmin, (req, res) => {
    try {
      const { familyId, invitedBy } = req.body;
      if (!familyId) return res.status(400).json({ error: "familyId requis" });
      const result = updateFamilyHost(familyId, invitedBy);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get registry gifts JSON data (scraped / updated periodically from Millemercis)
  app.get("/api/registry", (req, res) => {
    try {
      const jsonPath = path.join(process.cwd(), "src", "data", "registry_gifts.json");
      if (fs.existsSync(jsonPath)) {
        const data = fs.readFileSync(jsonPath, "utf-8");
        return res.json(JSON.parse(data));
      }
      res.status(404).json({ error: "Fichier registry_gifts.json introuvable" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update registry gifts JSON data (for Millemercis scraper script running every 5 minutes)
  app.post("/api/registry", requireAdmin, (req, res) => {
    try {
      const jsonPath = path.join(process.cwd(), "src", "data", "registry_gifts.json");
      const gifts = req.body;
      if (!Array.isArray(gifts)) {
        return res.status(400).json({ error: "Tableau de cadeaux valide requis" });
      }
      fs.writeFileSync(jsonPath, JSON.stringify(gifts, null, 2), "utf-8");
      res.json({ success: true, message: "Mise à jour des financements Millemercis réussie !" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Real-time guest & event statistics
  app.get("/api/stats", (req, res) => {
    try {
      const stats = getStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get all RSVP logs
  app.get("/api/rsvps", requireAdmin, (req, res) => {
    try {
      const isFull = Boolean((req as any).isAdminFull);
      let rsvps = getAllRSVPs();
      if (!isFull) {
        rsvps = rsvps.map((r: any) => ({
          ...r,
          message: "",
        }));
      }
      res.json(rsvps);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get all contact form messages (visible only to full admin)
  app.get("/api/admin/contact-messages", requireAdmin, (req, res) => {
    try {
      const isFull = Boolean((req as any).isAdminFull);
      if (!isFull) {
        return res.json([]);
      }
      res.json(getAllContactMessages());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clear all contact form messages
  app.post("/api/admin/clear-contact-messages", requireAdmin, (req, res) => {
    try {
      const result = clearAllContactMessages();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Download raw wedding.db binary SQLite file for OVHcloud / local backups
  app.get("/api/admin/download-db", requireAdmin, (req, res) => {
    try {
      saveDatabaseToDisk();
      const filePath = getDbFilePath();
      res.download(filePath, "wedding.db");
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Export CSV for caterer / wedding planner
  app.get("/api/admin/export-csv", requireAdmin, (req, res) => {
    try {
      const families = getAllFamiliesWithMembers();
      let csv =
        "ID Famille,Famille,Prénom,Nom,Statut,Âge,Présent,Vin d'Honneur,Repas de Noces,Brunch,Régime/Allergies,Email\n";

      families.forEach((fam) => {
        fam.members.forEach((m: any) => {
          csv += `"${fam.id}","${fam.familyName}","${m.firstName}","${m.lastName}","${
            m.isChild ? "Enfant" : "Adulte"
          }","${m.age || ""}","${m.isAttending ? "Oui" : "Non"}","${
            m.events.vinHonneur ? "Oui" : "Non"
          }","${m.events.repasNoces ? "Oui" : "Non"}","${
            m.events.brunchLendemain ? "Oui" : "Non"
          }","${m.dietaryNotes || ""}","${fam.email || ""}"\n`;
        });
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="liste_invites_mariage.csv"'
      );
      res.status(200).send("\uFEFF" + csv);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Export beautifully formatted weekly Excel report on demand
  app.get("/api/admin/export-recap-excel", requireAdmin, async (req, res) => {
    try {
      const allFamilies = getAllFamiliesWithMembers();
      const hostParam = (req.query.host as string) || "all";

      const OFFICIAL_HOSTS: Record<string, string> = {
        "Valentine&Jean": "Valentine & Jean",
        "Anny&Marc": "Anny & Marc",
        "Anne&Visith": "Anne & Visith",
        "all": "Tous les Invités",
      };

      const hostLabel = OFFICIAL_HOSTS[hostParam] || hostParam;
      const families = hostParam === "all" ? allFamilies : allFamilies.filter((f) => f.invitedBy === hostParam);

      let totalInvited = 0;
      let totalAdults = 0;
      let totalChildren = 0;
      let totalBabies = 0;

      let nonConfirmeCount = 0;
      let nonConfirmeAdults = 0;
      let nonConfirmeChildren = 0;
      let nonConfirmeBabies = 0;

      let presentsCount = 0;
      let presentAdults = 0;
      let presentChildren = 0;
      let presentBabies = 0;
      let vinCount = 0, vinAdults = 0, vinChildren = 0, vinBabies = 0;
      let repasCount = 0, repasAdults = 0, repasChildren = 0, repasBabies = 0;
      let brunchCount = 0, brunchAdults = 0, brunchChildren = 0, brunchBabies = 0;

      let absentsCount = 0;
      let absentAdults = 0;
      let absentChildren = 0;
      let absentBabies = 0;

      families.forEach((fam) => {
        const isResponded = Boolean(
          fam.hasResponded ||
          fam.respondedAt ||
          fam.notes === "has_responded" ||
          (fam.lastMessage && fam.lastMessage.trim().length > 0)
        );

        fam.members.forEach((m: any) => {
          totalInvited++;
          if (m.isBaby) totalBabies++;
          else if (m.isChild) totalChildren++;
          else totalAdults++;

          if (isResponded) {
            if (m.isAttending) {
              presentsCount++;
              if (m.isBaby) presentBabies++;
              else if (m.isChild) presentChildren++;
              else presentAdults++;

              const invitedVin = m.invitedTo ? m.invitedTo.vinHonneur !== false : true;
              const invitedRepas = m.invitedTo ? Boolean(m.invitedTo.repasNoces) : Boolean(m.events?.repasNoces);
              const invitedBrunch = m.invitedTo ? Boolean(m.invitedTo.brunchLendemain) : Boolean(m.events?.brunchLendemain);

              if (invitedVin && m.events?.vinHonneur) {
                vinCount++;
                if (m.isBaby) vinBabies++;
                else if (m.isChild) vinChildren++;
                else vinAdults++;
              }
              if (invitedRepas && m.events?.repasNoces) {
                repasCount++;
                if (m.isBaby) repasBabies++;
                else if (m.isChild) repasChildren++;
                else repasAdults++;
              }
              if (invitedBrunch && m.events?.brunchLendemain) {
                brunchCount++;
                if (m.isBaby) brunchBabies++;
                else if (m.isChild) brunchChildren++;
                else brunchAdults++;
              }
            } else {
              absentsCount++;
              if (m.isBaby) absentBabies++;
              else if (m.isChild) absentChildren++;
              else absentAdults++;
            }
          } else {
            nonConfirmeCount++;
            if (m.isBaby) nonConfirmeBabies++;
            else if (m.isChild) nonConfirmeChildren++;
            else nonConfirmeAdults++;
          }
        });
      });

      const now = new Date();
      const dateFormatted = new Intl.DateTimeFormat("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Paris",
      }).format(now).replace(":", "h");

      const buffer = await generateHostRecapExcel(hostLabel, families, {
        totalFamilies: families.length,
        totalInvited, totalAdults, totalChildren, totalBabies,
        presentsCount, presentAdults, presentChildren, presentBabies,
        nonConfirmeCount, nonConfirmeAdults, nonConfirmeChildren, nonConfirmeBabies,
        absentsCount, absentAdults, absentChildren, absentBabies,
        vinCount, vinAdults, vinChildren, vinBabies,
        repasCount, repasAdults, repasChildren, repasBabies,
        brunchCount, brunchAdults, brunchChildren, brunchBabies,
        dateFormatted,
      });

      const cleanName = hostLabel
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "_")
        .replace(/_+/g, "_");

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="Recapitulatif_Invites_${cleanName}.xlsx"`);
      res.status(200).send(buffer);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Trigger weekly recap emails by host (manual trigger from admin dashboard)
  app.post("/api/admin/send-recap-emails", requireAdmin, async (req, res) => {
    try {
      const allFamilies = getAllFamiliesWithMembers();
      const result = await sendHostRecapEmails(allFamilies);
      res.json({
        success: true,
        message: `${result.sentCount} email(s) récapitulatif(s) envoyé(s) avec succès.`,
        details: result.details,
      });
    } catch (err: any) {
      console.error("Erreur génération emails récapitulatifs par hôte:", err);
      res.status(500).json({ error: err.message || "Erreur serveur lors de l'envoi des emails." });
    }
  });

  // Vite middleware for development only (dynamic import: Vite must never load in production)
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // --- Millemercis Participation Scraper ---
  const syncMillemercis = async () => {
    try {
      const jsonPath = path.join(process.cwd(), "src", "data", "registry_gifts.json");
      if (fs.existsSync(jsonPath)) {
        const rawData = fs.readFileSync(jsonPath, "utf-8");
        const gifts = JSON.parse(rawData);
        let updated = false;

        for (const gift of gifts) {
          if (gift.actionUrl && gift.actionUrl.includes("millemercismariage.com")) {
            try {
              const res = await fetch(gift.actionUrl, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                }
              });
              const html = await res.text();
              const match = html.match(/Reste.*?offrir.*?:\s*([\d\s]+(?:,\d+)?)/i);
              if (match) {
                const remainingStr = match[1].replace(/\s/g, "").replace(",", ".");
                const remaining = parseFloat(remainingStr);
                if (!isNaN(remaining)) {
                  const newCurrentAmount = Math.max(0, gift.targetAmount - remaining);
                  if (gift.currentAmount !== newCurrentAmount) {
                    gift.currentAmount = newCurrentAmount;
                    updated = true;
                  }
                }
              }
            } catch (err) {
              console.error(`Erreur récupération de la participation pour ${gift.title}:`, err);
            }
          }
        }
        
        if (updated) {
          fs.writeFileSync(jsonPath, JSON.stringify(gifts, null, 2), "utf-8");
          console.log("[Mariage Server] Participations Millemercis synchronisées avec succès.");
        }
      }
    } catch (err) {
      console.error("Erreur lors de la synchronisation Millemercis:", err);
    }
  };

  // Lancement initial de la synchro puis toutes les 15 minutes
  syncMillemercis();
  setInterval(syncMillemercis, 15 * 60 * 1000);

  // --- Bot Récapitulatif Hebdomadaire (Vendredi à 20h00, heure de Paris) ---
  let lastRecapExecutionDate = "";
  const checkWeeklyRecapSchedule = () => {
    try {
      const now = new Date();
      const parisDay = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", weekday: "short" }).format(now);
      const parisHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hour: "numeric", hour12: false }).format(now), 10);
      const parisMinute = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", minute: "numeric", hour12: false }).format(now), 10);
      const parisDate = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(now);

      // Exécution le vendredi à 20h00 (fenêtre de 20h00 à 20h05 en cas de reboot)
      if (parisDay === "Fri" && parisHour === 20 && parisMinute >= 0 && parisMinute <= 5) {
        if (lastRecapExecutionDate !== parisDate) {
          lastRecapExecutionDate = parisDate;
          console.log(`[Recap Bot] ⏰ Déclenchement automatique du récapitulatif du vendredi 20h (${parisDate})`);
          const allFamilies = getAllFamiliesWithMembers();
          sendHostRecapEmails(allFamilies)
            .then((r) => {
              console.log(`[Recap Bot] ✅ ${r.sentCount} emails récapitulatifs envoyés avec succès.`);
            })
            .catch((err) => {
              console.error("[Recap Bot] ❌ Erreur lors de l'envoi auto des récapitulatifs:", err);
            });
        }
      }
    } catch (err) {
      console.error("[Recap Bot] Erreur calendrier récapitulatif:", err);
    }
  };

  // Vérification toutes les 30 secondes
  checkWeeklyRecapSchedule();
  setInterval(checkWeeklyRecapSchedule, 30 * 1000);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `[Mariage Server] Serveur démarré avec SQLite wedding.db sur http://localhost:${PORT}`
    );
  });
}

startServer();
