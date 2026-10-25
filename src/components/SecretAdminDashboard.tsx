/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { Database, Download, FileSpreadsheet, ShieldCheck, RefreshCw, Search, Users, Baby, Utensils, MessageSquare, Check, X, ArrowLeft, Trash2, Edit2, Mail } from 'lucide-react';
import ChildIcon from './ChildIcon';
import { GuestFamily, RSVPStats, FamilyMember } from '../types';
import { getStoredFamilies, clearLocalStorageRSVPs } from '../utils/rsvpStorage';
import AdminAddFamily from './AdminAddFamily';
import AdminEditFamilyModal from './AdminEditFamilyModal';

interface SecretAdminDashboardProps {
  onBackToHome?: () => void;
}

const formatDate = (dateStr?: string | null) => {
  if (!dateStr) return '';
  try {
    const utcStr = dateStr.includes('Z') || dateStr.includes('+')
      ? dateStr
      : dateStr.replace(' ', 'T') + 'Z';
    const d = new Date(utcStr);
    if (isNaN(d.getTime())) return dateStr;
    
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Paris',
    }).format(d).replace(':', 'h');
  } catch (e) {
    return dateStr;
  }
};

interface ContactMessage {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  created_at: string;
}

// Same values as the <select> of the contact form (Contact.tsx)
const CONTACT_SUBJECT_LABELS: Record<string, string> = {
  question: "Question sur l'organisation",
  rsvp: "Question sur la validation de présence",
  lodging: 'Question hébergement',
  surprise: "Préparation d'une surprise",
  'sweet-word': 'Un mot doux pour les mariés',
};

// Admin token kept in memory only for the current visit — never stored,
// so the password is asked again on every visit to the admin page.
let currentToken = '';
const getAdminToken = () => currentToken;
const adminHeaders = (): Record<string, string> => {
  const token = getAdminToken();
  return token ? { 'x-admin-token': token } : {};
};

// Helpers to determine invitation scope per member & family
export const isMemberInvitedToVin = (m: any): boolean => {
  return m.invitedTo ? m.invitedTo.vinHonneur !== false : true;
};

export const isMemberInvitedToRepas = (m: any): boolean => {
  return Boolean(m.invitedTo?.repasNoces || m.events?.repasNoces);
};

export const isMemberInvitedToBrunch = (m: any): boolean => {
  return Boolean(m.invitedTo?.brunchLendemain || m.events?.brunchLendemain);
};

export const isFamilyInvitedToVin = (fam: GuestFamily): boolean => {
  return fam.members.some(isMemberInvitedToVin);
};

export const isFamilyInvitedToRepas = (fam: GuestFamily): boolean => {
  return fam.members.some(isMemberInvitedToRepas);
};

export const isFamilyInvitedToBrunch = (fam: GuestFamily): boolean => {
  return fam.members.some(isMemberInvitedToBrunch);
};

export const isFamilyInvitedToVinOnly = (fam: GuestFamily): boolean => {
  return isFamilyInvitedToVin(fam) && !isFamilyInvitedToRepas(fam) && !isFamilyInvitedToBrunch(fam);
};

export const isFamilyInvitedToRepasNoBrunch = (fam: GuestFamily): boolean => {
  return isFamilyInvitedToRepas(fam) && !isFamilyInvitedToBrunch(fam);
};

export const isFamilyInvitedToAllThree = (fam: GuestFamily): boolean => {
  return isFamilyInvitedToVin(fam) && isFamilyInvitedToRepas(fam) && isFamilyInvitedToBrunch(fam);
};

export default function SecretAdminDashboard({ onBackToHome }: SecretAdminDashboardProps) {
  const [families, setFamilies] = useState<GuestFamily[]>([]);
  const [stats, setStats] = useState<RSVPStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<
    'all' | 'attending' | 'pending' | 'absent' | 'dietary' | 'attending_vin' | 'attending_repas' | 'attending_brunch' | 'letters_missing' | 'letters_done'
  >('all');
  const [filterInvitation, setFilterInvitation] = useState<
    'all' | 'vin' | 'repas' | 'brunch' | 'vin_only' | 'repas_no_brunch' | 'all_three'
  >('all');
  const [filterHost, setFilterHost] = useState<'all' | 'unassigned' | 'Valentine&Jean' | 'Anny&Marc' | 'Anne&Visith'>('all');
  const [contactMessages, setContactMessages] = useState<ContactMessage[]>([]);
  const [editingFamily, setEditingFamily] = useState<GuestFamily | null>(null);
  const [sendingRecap, setSendingRecap] = useState(false);
  const [canSeeOptionalNotes, setCanSeeOptionalNotes] = useState(false);
  const [editingNoteMember, setEditingNoteMember] = useState<{ member: FamilyMember; familyName: string; familyId: string } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaveSuccess, setNoteSaveSuccess] = useState(false);

  // Authentication gate: null = checking, true = dashboard (native browser prompt)
  const [authed, setAuthed] = useState<boolean | null>(null);

  const verifyToken = async (token: string): Promise<{ ok: boolean; canSeeOptionalNotes?: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/admin/verify', {
        headers: token ? { 'x-admin-token': token } : {},
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: true, canSeeOptionalNotes: Boolean(data.canSeeOptionalNotes) };
      }
      if (res.status === 503) {
        const data = await res.json().catch(() => ({} as any));
        return { ok: false, error: data.error || 'ADMIN_TOKEN non configuré sur le serveur.' };
      }
      return { ok: false, error: 'incorrect' };
    } catch {
      return { ok: false, error: 'Serveur injoignable, réessayez plus tard.' };
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/stats');
      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          if (data && typeof data.totalFamilies === 'number') {
            setStats(data);
            return;
          }
        } catch (jsonErr) {}
      }
    } catch (e) {
      console.error('Erreur chargement stats API:', e);
    }
  };

  const fetchFamilies = async () => {
    try {
      const res = await fetch('/api/families', { headers: adminHeaders() });
      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data) && data.length > 0) {
            setFamilies(data);
            setLoading(false);
            return;
          }
        } catch (jsonErr) {}
      }
    } catch (e) {
      console.error('Erreur chargement familles API:', e);
    }
    // Fallback to localStorage + pre-seeded list in production / static mode
    const localFamilies = getStoredFamilies();
    setFamilies(localFamilies);
    setLoading(false);
  };

  const fetchContactMessages = async () => {
    try {
      const res = await fetch('/api/admin/contact-messages', { headers: adminHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setContactMessages(data);
      }
    } catch (e) {
      console.error('Erreur chargement messages de contact:', e);
    }
  };

  // On every visit: ask the password via the native browser prompt (never stored)
  useEffect(() => {
    (async () => {
      currentToken = '';
      let result = await verifyToken(''); // passes only in dev (no ADMIN_TOKEN required)
      if (result.ok) {
        setCanSeeOptionalNotes(Boolean(result.canSeeOptionalNotes));
      }
      let message = 'Espace Mariés — mot de passe :';
      while (!result.ok) {
        if (result.error && result.error !== 'incorrect') {
          window.alert(result.error);
          onBackToHome?.();
          return;
        }
        const pwd = window.prompt(message);
        if (pwd === null || !pwd.trim()) {
          onBackToHome?.();
          return;
        }
        result = await verifyToken(pwd.trim());
        if (result.ok) {
          currentToken = pwd.trim();
          setCanSeeOptionalNotes(Boolean(result.canSeeOptionalNotes));
        } else {
          message = 'Mot de passe incorrect, réessayez :';
        }
      }
      setAuthed(true);
      fetchStats();
      fetchFamilies();
      fetchContactMessages();
    })();
  }, []);

  const handleUpdateInvitation = async (familyId: string, vin: boolean, repas: boolean, brunch: boolean) => {
    try {
      const res = await fetch('/api/admin/update-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({ familyId, invitedVin: vin, invitedRepas: repas, invitedBrunch: brunch }),
      });
      if (res.ok) {
        fetchFamilies();
        fetchStats();
      }
    } catch (e) {
      console.error('Erreur mise à jour portée invitation:', e);
    }
  };

  const handleDeleteFamily = async (famId: string, famName: string) => {
    if (window.confirm(`Êtes-vous sûr de vouloir supprimer la famille ${famName} ? Toutes les réponses associées seront effacées.`)) {
      try {
        const res = await fetch(`/api/admin/families/${famId}`, {
          method: 'DELETE',
          headers: adminHeaders()
        });
        if (res.ok) {
          fetchFamilies();
          fetchStats();
        } else {
          alert("Erreur lors de la suppression.");
        }
      } catch (err) {
        alert("Erreur lors de la suppression.");
      }
    }
  };

  const handleUpdateFamilyHost = async (familyId: string, host: string) => {
    const newHost = host || null;
    setFamilies((prev) =>
      prev.map((f) => (f.id === familyId ? { ...f, invitedBy: newHost } : f))
    );
    try {
      const res = await fetch('/api/admin/update-family-host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({ familyId, invitedBy: newHost }),
      });
      if (!res.ok) {
        fetchFamilies();
      }
    } catch (e) {
      console.error('Erreur mise à jour hôte famille:', e);
      fetchFamilies();
    }
  };

  const handleSendRecapEmails = async () => {
    const confirmed = window.confirm(
      "Voulez-vous générer et envoyer maintenant les emails récapitulatifs par hôte (Valentine & Jean, Anny & Marc, Anne & Visith) ?"
    );
    if (!confirmed) return;

    setSendingRecap(true);
    try {
      const res = await fetch('/api/admin/send-recap-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(`✅ ${data.message || 'Emails récapitulatifs envoyés avec succès !'}`);
      } else {
        alert(`❌ Erreur : ${data.error || "Impossible d'envoyer les emails récapitulatifs."}`);
      }
    } catch (err: any) {
      console.error("Erreur envoi récapitulatif:", err);
      alert("❌ Erreur réseau lors de la génération des emails.");
    } finally {
      setSendingRecap(false);
    }
  };

  const isMemberAttendingDinner = (m: FamilyMember) => {
    const invitedRepas = isMemberInvitedToRepas(m);
    return Boolean(m.isAttending && (m.events?.repasNoces ?? invitedRepas));
  };

  const dinnerConfirmedMembers = useMemo(() => {
    return families.flatMap((f) => f.members).filter((m) => isMemberAttendingDinner(m));
  }, [families]);

  const lettersWrittenCount = useMemo(() => {
    return dinnerConfirmedMembers.filter((m) => Boolean(m.weddingNote && m.weddingNote.trim())).length;
  }, [dinnerConfirmedMembers]);

  const lettersMissingCount = Math.max(0, dinnerConfirmedMembers.length - lettersWrittenCount);

  const handleSaveWeddingNote = async () => {
    if (!editingNoteMember) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/admin/members/${editingNoteMember.member.id}/wedding-note`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...adminHeaders(),
        },
        body: JSON.stringify({ weddingNote: noteText }),
      });
      if (res.ok) {
        setFamilies((prev) =>
          prev.map((f) => {
            if (f.id === editingNoteMember.familyId) {
              return {
                ...f,
                members: f.members.map((m) =>
                  m.id === editingNoteMember.member.id ? { ...m, weddingNote: noteText.trim() } : m
                ),
              };
            }
            return f;
          })
        );
        setNoteSaveSuccess(true);
        setTimeout(() => {
          setNoteSaveSuccess(false);
          setEditingNoteMember(null);
        }, 800);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Erreur lors de l'enregistrement du mot.");
      }
    } catch (err: any) {
      alert(err.message || "Erreur réseau.");
    } finally {
      setSavingNote(false);
    }
  };

  // Scope of families for the top breakdown cards (dynamically filtered by active host or search filter)
  const breakdownFamilies = useMemo(() => {
    return families.filter((fam) => {
      // 1. Host Filter
      if (filterHost === 'unassigned' && fam.invitedBy) return false;
      if (filterHost !== 'all' && filterHost !== 'unassigned' && fam.invitedBy !== filterHost) return false;

      // 2. Search Query (if searching for a name, also filter breakdown metrics)
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const nameMatch = fam.familyName.toLowerCase().includes(q) || fam.members.some((m) => `${m.firstName} ${m.lastName}`.toLowerCase().includes(q));
        if (!nameMatch) return false;
      }

      return true;
    });
  }, [families, filterHost, search]);

  // Compute breakdown of Adults & Children per Event
  const eventBreakdown = useMemo(() => {
    let vinAdults = 0, vinChildren = 0, vinBabies = 0;
    let repasAdults = 0, repasChildren = 0, repasBabies = 0;
    let brunchAdults = 0, brunchChildren = 0, brunchBabies = 0;
    let totalAdultsAttending = 0, totalChildrenAttending = 0, totalBabiesAttending = 0;
    let vinInvited = 0, repasInvited = 0, brunchInvited = 0;
    let totalRespondedMembers = 0;
    let totalNotRespondedMembers = 0;
    let totalAbsentAdults = 0, totalAbsentChildren = 0, totalAbsentBabies = 0;

    let totalInvitedMembers = 0;
    let totalInvitedAdults = 0, totalInvitedChildren = 0, totalInvitedBabies = 0;
    let vinInvitedAdults = 0, vinInvitedChildren = 0, vinInvitedBabies = 0;
    let repasInvitedAdults = 0, repasInvitedChildren = 0, repasInvitedBabies = 0;
    let brunchInvitedAdults = 0, brunchInvitedChildren = 0, brunchInvitedBabies = 0;

    breakdownFamilies.forEach((fam) => {
      fam.members.forEach((m) => {
        totalInvitedMembers++;
        if (m.isBaby) totalInvitedBabies++;
        else if (m.isChild) totalInvitedChildren++;
        else totalInvitedAdults++;

        // Un membre est invité par défaut au vin d'honneur s'il n'y a pas d'exclusion explicite
        if (m.invitedTo?.vinHonneur !== false) {
          vinInvited++;
          if (m.isBaby) vinInvitedBabies++;
          else if (m.isChild) vinInvitedChildren++;
          else vinInvitedAdults++;
        }
        if (m.invitedTo?.repasNoces || m.events?.repasNoces) {
          repasInvited++;
          if (m.isBaby) repasInvitedBabies++;
          else if (m.isChild) repasInvitedChildren++;
          else repasInvitedAdults++;
        }
        if (m.invitedTo?.brunchLendemain || m.events?.brunchLendemain) {
          brunchInvited++;
          if (m.isBaby) brunchInvitedBabies++;
          else if (m.isChild) brunchInvitedChildren++;
          else brunchInvitedAdults++;
        }
      });

      const isResponded = Boolean(
        fam.hasResponded ||
        fam.respondedAt ||
        fam.notes === 'has_responded' ||
        (fam.lastMessage && fam.lastMessage.trim().length > 0)
      );

      // ONLY count attendance metrics for families that HAVE RESPONDED
      if (isResponded) {
        fam.members.forEach((m) => {
          totalRespondedMembers++;
          if (m.isAttending) {
            if (m.isBaby) totalBabiesAttending++;
            else if (m.isChild) totalChildrenAttending++;
            else totalAdultsAttending++;

            if (m.events?.vinHonneur) {
              if (m.isBaby) vinBabies++;
              else if (m.isChild) vinChildren++;
              else vinAdults++;
            }
            if (m.events?.repasNoces) {
              if (m.isBaby) repasBabies++;
              else if (m.isChild) repasChildren++;
              else repasAdults++;
            }
            if (m.events?.brunchLendemain) {
              if (m.isBaby) brunchBabies++;
              else if (m.isChild) brunchChildren++;
              else brunchAdults++;
            }
          } else {
            if (m.isBaby) totalAbsentBabies++;
            else if (m.isChild) totalAbsentChildren++;
            else totalAbsentAdults++;
          }
        });
      } else {
        fam.members.forEach(() => {
          totalNotRespondedMembers++;
        });
      }
    });

    return {
      totalInvitedMembers,
      totalAdultsAttending,
      totalChildrenAttending,
      totalBabiesAttending,
      vinAdults,
      vinChildren,
      vinBabies,
      repasAdults,
      repasChildren,
      repasBabies,
      brunchAdults,
      brunchChildren,
      brunchBabies,
      vinInvited,
      repasInvited,
      brunchInvited,
      totalInvitedAdults,
      totalInvitedChildren,
      totalInvitedBabies,
      vinInvitedAdults,
      vinInvitedChildren,
      vinInvitedBabies,
      repasInvitedAdults,
      repasInvitedChildren,
      repasInvitedBabies,
      brunchInvitedAdults,
      brunchInvitedChildren,
      brunchInvitedBabies,
      totalRespondedMembers,
      totalNotRespondedMembers,
      totalAbsentAdults,
      totalAbsentChildren,
      totalAbsentBabies
    };
  }, [breakdownFamilies]);


  // Compute breakdown by host (Invité par)
  const hostStats = useMemo(() => {
    let vjFamilies = 0, vjGuests = 0, vjAttending = 0;
    let amFamilies = 0, amGuests = 0, amAttending = 0;
    let avFamilies = 0, avGuests = 0, avAttending = 0;
    let unassignedFamilies = 0, unassignedGuests = 0;

    families.forEach((fam) => {
      const gCount = fam.members.length;
      const aCount = fam.members.filter((m) => m.isAttending).length;

      if (fam.invitedBy === 'Valentine&Jean') {
        vjFamilies++;
        vjGuests += gCount;
        vjAttending += aCount;
      } else if (fam.invitedBy === 'Anny&Marc') {
        amFamilies++;
        amGuests += gCount;
        amAttending += aCount;
      } else if (fam.invitedBy === 'Anne&Visith') {
        avFamilies++;
        avGuests += gCount;
        avAttending += aCount;
      } else {
        unassignedFamilies++;
        unassignedGuests += gCount;
      }
    });

    return {
      vj: { families: vjFamilies, guests: vjGuests, attending: vjAttending },
      am: { families: amFamilies, guests: amGuests, attending: amAttending },
      av: { families: avFamilies, guests: avGuests, attending: avAttending },
      unassigned: { families: unassignedFamilies, guests: unassignedGuests },
    };
  }, [families]);

  // Compute breakdown by invitation scope
  const invitationStats = useMemo(() => {
    let vinFam = 0, vinGuests = 0;
    let repasFam = 0, repasGuests = 0;
    let brunchFam = 0, brunchGuests = 0;
    let vinOnlyFam = 0, vinOnlyGuests = 0;
    let vinRepasFam = 0, vinRepasGuests = 0;

    breakdownFamilies.forEach((fam) => {
      const hasFamVin = isFamilyInvitedToVin(fam);
      const hasFamRepas = isFamilyInvitedToRepas(fam);
      const hasFamBrunch = isFamilyInvitedToBrunch(fam);
      const hasFamVinOnly = isFamilyInvitedToVinOnly(fam);
      const hasFamVinRepas = isFamilyInvitedToRepasNoBrunch(fam);

      if (hasFamVin) vinFam++;
      if (hasFamRepas) repasFam++;
      if (hasFamBrunch) brunchFam++;
      if (hasFamVinOnly) vinOnlyFam++;
      if (hasFamVinRepas) vinRepasFam++;

      fam.members.forEach((m) => {
        const invVin = isMemberInvitedToVin(m);
        const invRepas = isMemberInvitedToRepas(m);
        const invBrunch = isMemberInvitedToBrunch(m);

        if (invVin) vinGuests++;
        if (invRepas) repasGuests++;
        if (invBrunch) brunchGuests++;
        if (invVin && !invRepas && !invBrunch) vinOnlyGuests++;
        if (invVin && invRepas && !invBrunch) vinRepasGuests++;
      });
    });

    return {
      vin: { families: vinFam, guests: vinGuests },
      repas: { families: repasFam, guests: repasGuests },
      brunch: { families: brunchFam, guests: brunchGuests },
      vinOnly: { families: vinOnlyFam, guests: vinOnlyGuests },
      vinRepas: { families: vinRepasFam, guests: vinRepasGuests },
    };
  }, [breakdownFamilies]);

  // Filtered families list
  const filteredFamilies = useMemo(() => {
    return families.filter((fam) => {
      // 1. Search Query
      const q = search.toLowerCase().trim();
      const nameMatch = !q || fam.familyName.toLowerCase().includes(q) || fam.members.some((m) => `${m.firstName} ${m.lastName}`.toLowerCase().includes(q));
      if (!nameMatch) return false;

      // 2. Filter Host
      if (filterHost === 'unassigned' && fam.invitedBy) return false;
      if (filterHost !== 'all' && filterHost !== 'unassigned' && fam.invitedBy !== filterHost) return false;

      // 3. Filter Invitation Scope (Qui est invité à quoi)
      if (filterInvitation === 'vin' && !isFamilyInvitedToVin(fam)) return false;
      if (filterInvitation === 'repas' && !isFamilyInvitedToRepas(fam)) return false;
      if (filterInvitation === 'brunch' && !isFamilyInvitedToBrunch(fam)) return false;
      if (filterInvitation === 'vin_only' && !isFamilyInvitedToVinOnly(fam)) return false;
      if (filterInvitation === 'repas_no_brunch' && !isFamilyInvitedToRepasNoBrunch(fam)) return false;
      if (filterInvitation === 'all_three' && !isFamilyInvitedToAllThree(fam)) return false;

      // 4. Filter Status & Attendance
      const isResponded = Boolean(
        fam.hasResponded ||
        fam.respondedAt ||
        fam.notes === 'has_responded' ||
        (fam.lastMessage && fam.lastMessage.trim().length > 0)
      );

      if (filterStatus === 'attending' && !fam.members.some((m) => m.isAttending)) return false;
      if (filterStatus === 'pending' && isResponded) return false;
      if (filterStatus === 'absent' && (!isResponded || fam.members.some((m) => m.isAttending))) return false;
      if (filterStatus === 'dietary' && !fam.members.some((m) => m.dietaryNotes && m.dietaryNotes.trim())) return false;
      if (filterStatus === 'attending_vin' && !fam.members.some((m) => m.isAttending && m.events?.vinHonneur)) return false;
      if (filterStatus === 'attending_repas' && !fam.members.some((m) => m.isAttending && m.events?.repasNoces)) return false;
      if (filterStatus === 'attending_brunch' && !fam.members.some((m) => m.isAttending && m.events?.brunchLendemain)) return false;
      if (filterStatus === 'letters_missing' && !fam.members.some((m) => isMemberAttendingDinner(m) && (!m.weddingNote || !m.weddingNote.trim()))) return false;
      if (filterStatus === 'letters_done' && !fam.members.some((m) => Boolean(m.weddingNote && m.weddingNote.trim()))) return false;

      return true;
    });
  }, [families, search, filterHost, filterInvitation, filterStatus]);

  // Waiting for authentication (native browser prompt)
  if (!authed) {
    return (
      <div className="w-full max-w-md mx-auto px-4 py-24 text-center">
        <RefreshCw className="w-6 h-6 text-[#C4A475] animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-8" id="secret-admin-dashboard">

      {/* 1. HEADER WITH GO BACK & REFRESH BUTTONS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/90 backdrop-blur-md p-6 rounded-3xl border border-[#13263B]/15 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-[#13263B] text-[#C4A475] rounded-2xl shadow-xs">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display text-2xl text-[#13263B] font-bold">
                Espace Mariés • Requêtes &amp; Statistiques
              </h2>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 font-mono">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Base SQLite active (wedding.db)
              </span>
              {canSeeOptionalNotes ? (
                <span className="text-[10px] bg-amber-100 text-amber-900 font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 font-mono border border-amber-300">
                  👑 Accès complet (mots optionnels visibles)
                </span>
              ) : (
                <span className="text-[10px] bg-slate-100 text-slate-700 font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 font-mono border border-slate-300">
                  🔒 Accès restreint (mots optionnels masqués)
                </span>
              )}
            </div>
            <p className="font-serif italic text-xs text-[#5A5040] mt-0.5">
              Page secrète réservée aux mariés pour faire vos requêtes sur qui a répondu, décompter adultes &amp; enfants par repas, et exporter les fichiers.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSendRecapEmails}
            disabled={sendingRecap}
            className="px-4 py-2 bg-[#C4A475] hover:bg-[#b39263] text-[#13263B] text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs disabled:opacity-50"
            title="Générer et envoyer les emails récapitulatifs par hôte (tourne aussi automatiquement chaque vendredi à 20h)"
          >
            <Mail className={`w-3.5 h-3.5 ${sendingRecap ? 'animate-bounce' : ''}`} />
            <span>{sendingRecap ? 'Envoi en cours...' : 'Envoyer récapitulatifs hôtes'}</span>
          </button>

          <button
            onClick={() => {
              setLoading(true);
              fetchStats();
              fetchFamilies();
              fetchContactMessages();
            }}
            className="px-4 py-2 bg-[#13263B] hover:bg-[#C4A475] hover:text-[#13263B] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualiser</span>
          </button>
        </div>
      </div>

      {/* 1.5 ADD GUESTS SECTION */}
      <AdminAddFamily onSuccess={() => { fetchFamilies(); fetchStats(); }} adminHeaders={adminHeaders} />

      {/* 2. REPARTITION EXACTE DES ADULTES & ENFANTS PAR TYPE DE REPAS / ÉVÉNEMENT */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h3 className="font-display text-xl text-[#13263B] font-semibold flex items-center gap-2">
            <Users className="w-5 h-5 text-[#C4A475]" />
            <span>Décompte par Type de Repas (Adultes vs Enfants)</span>
          </h3>
          {(filterHost !== 'all' || search.trim()) && (
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-[#13263B] text-white self-start sm:self-auto font-sans flex items-center gap-1.5 shadow-2xs">
              <span>Filtre :</span>
              <span className="text-[#C4A475] font-bold">
                {filterHost === 'Valentine&Jean' ? 'Valentine & Jean' : filterHost === 'Anny&Marc' ? 'Anny & Marc' : filterHost === 'Anne&Visith' ? 'Anne & Visith' : filterHost === 'unassigned' ? 'À catégoriser' : ''}
                {search.trim() ? (filterHost !== 'all' ? ` + « ${search.trim()} »` : `« ${search.trim()} »`) : ''}
              </span>
              <span className="opacity-75 font-mono text-[11px]">({breakdownFamilies.length} fam. / {eventBreakdown.totalInvitedMembers} pers.)</span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          
          {/* Card 0: État des réponses */}
          <div className="bg-white p-5 rounded-2xl border border-indigo-200 shadow-2xs flex flex-col justify-between space-y-2">
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-indigo-700 block">
              📊 ÉTAT DES RÉPONSES
            </span>
            <div className="flex items-baseline justify-between">
              <span className="font-display text-3xl font-bold text-indigo-900">
                {eventBreakdown.totalRespondedMembers}
              </span>
              <span className="text-xs font-mono text-slate-500">
                / {eventBreakdown.totalInvitedMembers} ont répondu
              </span>
            </div>
            <div className="pt-2 border-t border-slate-100 text-xs text-[#5A5040] font-sans space-y-0.5">
              <div className="flex justify-between">
                <span>En attente :</span>
                <strong className="text-amber-600">{eventBreakdown.totalNotRespondedMembers}</strong>
              </div>
              <div className="flex justify-between">
                <span>Absents déclarés :</span>
                <strong className="text-rose-600">{eventBreakdown.totalAbsentAdults + eventBreakdown.totalAbsentChildren + eventBreakdown.totalAbsentBabies}</strong>
              </div>
            </div>
          </div>

          {/* Card Total Confirmed */}
          <div className="bg-white p-5 rounded-2xl border border-[#3B6FA0]/20 shadow-2xs flex flex-col justify-between space-y-2">
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#3B6FA0] block">
              ✅ PRÉSENTS (GLOBAL)
            </span>
            <div className="flex items-baseline justify-between">
              <span className="font-display text-3xl font-bold text-[#13263B]">
                {eventBreakdown.totalAdultsAttending + eventBreakdown.totalChildrenAttending + eventBreakdown.totalBabiesAttending}
              </span>
              <span className="text-xs font-mono text-slate-500">
                / {eventBreakdown.totalInvitedMembers} invités
              </span>
            </div>
            <div className="pt-2 border-t border-slate-100 text-xs text-[#5A5040] font-sans space-y-0.5">
              <div className="flex justify-between">
                <span>Adultes :</span>
                <strong className="text-[#13263B]">{eventBreakdown.totalAdultsAttending} <span className="font-normal text-slate-400">/ {eventBreakdown.totalInvitedAdults}</span></strong>
              </div>
              <div className="flex justify-between">
                <span>Enfants :</span>
                <strong className="text-[#C4A475]">{eventBreakdown.totalChildrenAttending} <span className="font-normal text-slate-400">/ {eventBreakdown.totalInvitedChildren}</span></strong>
              </div>
              <div className="flex justify-between">
                <span>Bébés :</span>
                <strong className="text-slate-500">{eventBreakdown.totalBabiesAttending} <span className="font-normal text-slate-400">/ {eventBreakdown.totalInvitedBabies}</span></strong>
              </div>
            </div>
          </div>

          {/* Card 1: Vin d'Honneur */}
          <div className="bg-white p-5 rounded-2xl border border-[#3B6FA0]/20 shadow-2xs flex flex-col justify-between space-y-2">
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#13263B] block">
              🍸 VIN D'HONNEUR (18H00)
            </span>
            <div className="flex items-baseline justify-between">
              <span className="font-display text-3xl font-bold text-[#13263B]">
                {eventBreakdown.vinAdults + eventBreakdown.vinChildren + eventBreakdown.vinBabies}
              </span>
              <span className="text-xs font-mono text-slate-500">/ {eventBreakdown.vinInvited} invités</span>
            </div>
            <div className="pt-2 border-t border-slate-100 text-xs text-[#5A5040] font-sans space-y-0.5">
              <div className="flex justify-between">
                <span>Adultes :</span>
                <strong className="text-[#13263B]">{eventBreakdown.vinAdults} <span className="font-normal text-slate-400">/ {eventBreakdown.vinInvitedAdults}</span></strong>
              </div>
              <div className="flex justify-between">
                <span>Enfants :</span>
                <strong className="text-[#C4A475]">{eventBreakdown.vinChildren} <span className="font-normal text-slate-400">/ {eventBreakdown.vinInvitedChildren}</span></strong>
              </div>
              <div className="flex justify-between">
                <span>Bébés :</span>
                <strong className="text-slate-500">{eventBreakdown.vinBabies} <span className="font-normal text-slate-400">/ {eventBreakdown.vinInvitedBabies}</span></strong>
              </div>
            </div>
          </div>

          {/* Card 2: Repas de Noces */}
          <div className="bg-white p-5 rounded-2xl border border-[#C4A475]/40 shadow-2xs flex flex-col justify-between space-y-2">
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-[#C4A475] block">
              🍽️ REPAS DE NOCES (19H00)
            </span>
            <div className="flex items-baseline justify-between">
              <span className="font-display text-3xl font-bold text-[#C4A475]">
                {eventBreakdown.repasAdults + eventBreakdown.repasChildren + eventBreakdown.repasBabies}
              </span>
              <span className="text-xs font-mono text-slate-500">/ {eventBreakdown.repasInvited} invités</span>
            </div>
            <div className="pt-2 border-t border-slate-100 text-xs text-[#5A5040] font-sans space-y-0.5">
              <div className="flex justify-between">
                <span>Adultes :</span>
                <strong className="text-[#13263B]">{eventBreakdown.repasAdults} <span className="font-normal text-slate-400">/ {eventBreakdown.repasInvitedAdults}</span></strong>
              </div>
              <div className="flex justify-between">
                <span>Enfants :</span>
                <strong className="text-[#C4A475]">{eventBreakdown.repasChildren} <span className="font-normal text-slate-400">/ {eventBreakdown.repasInvitedChildren}</span></strong>
              </div>
              <div className="flex justify-between">
                <span>Bébés :</span>
                <strong className="text-slate-500">{eventBreakdown.repasBabies} <span className="font-normal text-slate-400">/ {eventBreakdown.repasInvitedBabies}</span></strong>
              </div>
            </div>
          </div>

          {/* Card 3: Brunch du Lendemain */}
          <div className="bg-white p-5 rounded-2xl border border-amber-300 shadow-2xs flex flex-col justify-between space-y-2">
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-amber-800 block">
              🥐 BRUNCH DU LENDEMAIN
            </span>
            <div className="flex items-baseline justify-between">
              <span className="font-display text-3xl font-bold text-amber-800">
                {eventBreakdown.brunchAdults + eventBreakdown.brunchChildren + eventBreakdown.brunchBabies}
              </span>
              <span className="text-xs font-mono text-slate-500">/ {eventBreakdown.brunchInvited} invités</span>
            </div>
            <div className="pt-2 border-t border-slate-100 text-xs text-[#5A5040] font-sans space-y-0.5">
              <div className="flex justify-between">
                <span>Adultes :</span>
                <strong className="text-[#13263B]">{eventBreakdown.brunchAdults} <span className="font-normal text-slate-400">/ {eventBreakdown.brunchInvitedAdults}</span></strong>
              </div>
              <div className="flex justify-between">
                <span>Enfants :</span>
                <strong className="text-[#C4A475]">{eventBreakdown.brunchChildren} <span className="font-normal text-slate-400">/ {eventBreakdown.brunchInvitedChildren}</span></strong>
              </div>
              <div className="flex justify-between">
                <span>Bébés :</span>
                <strong className="text-slate-500">{eventBreakdown.brunchBabies} <span className="font-normal text-slate-400">/ {eventBreakdown.brunchInvitedBabies}</span></strong>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* 3. INTERACTIVE QUERY TABLE & SEARCH FILTERS */}
      <div className="bg-white rounded-3xl border border-[#3B6FA0]/15 p-4 sm:p-6 space-y-4 sm:space-y-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="font-display text-xl text-[#13263B] font-semibold">
                Requêteur des Réponses &amp; Invités ({filteredFamilies.length} familles)
              </h3>
              {(search.trim() || filterInvitation !== 'all' || filterStatus !== 'all' || filterHost !== 'all') && (
                <button
                  onClick={() => {
                    setSearch('');
                    setFilterInvitation('all');
                    setFilterStatus('all');
                    setFilterHost('all');
                  }}
                  className="text-[11px] text-[#3B6FA0] hover:text-red-600 hover:underline cursor-pointer flex items-center gap-1 font-sans font-semibold bg-blue-50/70 hover:bg-red-50 px-2 py-0.5 rounded-full transition-colors"
                  title="Réinitialiser tous les filtres"
                >
                  <X className="w-3 h-3" />
                  Effacer les filtres
                </button>
              )}
            </div>
            <p className="text-xs text-[#5A5040] font-serif italic">
              Filtrez instantanément par invitation (Vin d'honneur, Dîner, Brunch), statut de présence ou par hôte.
            </p>
          </div>

          {/* Filter Toolbar - Search & Response Status only */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-3 sm:mt-0 w-full sm:w-auto">
            {/* Search Input */}
            <div className="relative w-full sm:w-52">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Chercher par nom..."
                className="pl-8 pr-3 py-2 bg-[#FAF7F2] border border-slate-200 rounded-xl text-xs text-[#13263B] focus:outline-none focus:border-[#C4A475] w-full"
              />
            </div>

            {/* Status / Presence Filter */}
            <select
              value={filterStatus}
              onChange={(e: any) => setFilterStatus(e.target.value)}
              className="px-3 py-2 bg-[#FAF7F2] border border-slate-200 rounded-xl text-xs text-[#13263B] focus:outline-none font-sans cursor-pointer w-full sm:w-auto font-medium"
            >
              <option value="all">Tous statuts de réponse</option>
              <option value="attending">✅ Présents (au moins 1)</option>
              <option value="pending">⏳ En attente de réponse</option>
              <option value="absent">❌ Absents déclarés</option>
              <option value="attending_vin">🍸 Présents au Vin</option>
              <option value="attending_repas">🍽️ Présents au Dîner</option>
              <option value="attending_brunch">🥐 Présents au Brunch</option>
              <option value="dietary">🥗 Allergies / Régimes</option>
              {canSeeOptionalNotes && (
                <>
                  <option value="letters_missing">✉️ Lettres dîner : non rédigées</option>
                  <option value="letters_done">💌 Lettres dîner : rédigées</option>
                </>
              )}
            </select>
          </div>
        </div>

        {/* Host Quick Filter Pills - Mobile-friendly wrap & compact numbers */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pb-2.5 pt-0.5 border-b border-slate-100">
          <span className="w-full sm:w-auto text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0 mr-1 flex items-center gap-1">
            <Users className="w-3 h-3 text-[#C4A475]" />
            Par hôte :
          </span>
          <button
            onClick={() => setFilterHost('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer select-none touch-manipulation active:scale-95 ${
              filterHost === 'all'
                ? 'bg-[#13263B] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Tous ({families.length})
          </button>
          <button
            onClick={() => setFilterHost(filterHost === 'Valentine&Jean' ? 'all' : 'Valentine&Jean')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 select-none touch-manipulation active:scale-95 ${
              filterHost === 'Valentine&Jean'
                ? 'bg-[#13263B] text-white shadow-xs'
                : 'bg-blue-50 text-[#13263B] border border-blue-200 hover:bg-blue-100'
            }`}
          >
            <span>Valentine &amp; Jean</span>
            <span className="text-[10px] opacity-80 font-mono hidden sm:inline">({hostStats.vj.families} fam. / {hostStats.vj.guests} pers.)</span>
            <span className="text-[10px] opacity-80 font-mono sm:hidden">({hostStats.vj.families})</span>
          </button>
          <button
            onClick={() => setFilterHost(filterHost === 'Anny&Marc' ? 'all' : 'Anny&Marc')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 select-none touch-manipulation active:scale-95 ${
              filterHost === 'Anny&Marc'
                ? 'bg-rose-700 text-white shadow-xs'
                : 'bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100'
            }`}
          >
            <span>Anny &amp; Marc</span>
            <span className="text-[10px] opacity-80 font-mono hidden sm:inline">({hostStats.am.families} fam. / {hostStats.am.guests} pers.)</span>
            <span className="text-[10px] opacity-80 font-mono sm:hidden">({hostStats.am.families})</span>
          </button>
          <button
            onClick={() => setFilterHost(filterHost === 'Anne&Visith' ? 'all' : 'Anne&Visith')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 select-none touch-manipulation active:scale-95 ${
              filterHost === 'Anne&Visith'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100'
            }`}
          >
            <span>Anne &amp; Visith</span>
            <span className="text-[10px] opacity-80 font-mono hidden sm:inline">({hostStats.av.families} fam. / {hostStats.av.guests} pers.)</span>
            <span className="text-[10px] opacity-80 font-mono sm:hidden">({hostStats.av.families})</span>
          </button>
          {hostStats.unassigned.families > 0 && (
            <button
              onClick={() => setFilterHost(filterHost === 'unassigned' ? 'all' : 'unassigned')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1 select-none touch-manipulation active:scale-95 ${
                filterHost === 'unassigned'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
              }`}
            >
              <span>À catégoriser</span>
              <span className="text-[10px] font-mono">({hostStats.unassigned.families})</span>
            </button>
          )}
        </div>

        {/* Invitation Scope Quick Filter Pills - With VIN+DINER and Mobile-friendly wrap */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pb-2.5 pt-0.5 border-b border-slate-100">
          <span className="w-full sm:w-auto text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0 mr-1 flex items-center gap-1">
            <Utensils className="w-3 h-3 text-[#C4A475]" />
            Invités à :
          </span>
          <button
            onClick={() => setFilterInvitation('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer select-none touch-manipulation active:scale-95 ${
              filterInvitation === 'all'
                ? 'bg-[#13263B] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Toutes ({breakdownFamilies.length})
          </button>
          <button
            onClick={() => setFilterInvitation(filterInvitation === 'vin_only' ? 'all' : 'vin_only')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 select-none touch-manipulation active:scale-95 ${
              filterInvitation === 'vin_only'
                ? 'bg-indigo-700 text-white shadow-xs'
                : 'bg-indigo-50 text-indigo-900 border border-indigo-200 hover:bg-indigo-100'
            }`}
            title="Invités uniquement au Vin d'honneur (sans dîner)"
          >
            <span>🍸 Vin seul</span>
            <span className="text-[10px] opacity-80 font-mono hidden sm:inline">({invitationStats.vinOnly.families} fam. / {invitationStats.vinOnly.guests} pers.)</span>
            <span className="text-[10px] opacity-80 font-mono sm:hidden">({invitationStats.vinOnly.families})</span>
          </button>
          <button
            onClick={() => setFilterInvitation(filterInvitation === 'repas_no_brunch' ? 'all' : 'repas_no_brunch')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 select-none touch-manipulation active:scale-95 ${
              filterInvitation === 'repas_no_brunch'
                ? 'bg-[#13263B] text-white shadow-xs'
                : 'bg-blue-50 text-[#13263B] border border-blue-200 hover:bg-blue-100'
            }`}
            title="Invités au Vin d'honneur et au Dîner (sans le Brunch du lendemain)"
          >
            <span>🍸🍽️ Vin + Dîner</span>
            <span className="text-[10px] opacity-80 font-mono hidden sm:inline">({invitationStats.vinRepas.families} fam. / {invitationStats.vinRepas.guests} pers.)</span>
            <span className="text-[10px] opacity-80 font-mono sm:hidden">({invitationStats.vinRepas.families})</span>
          </button>
          <button
            onClick={() => setFilterInvitation(filterInvitation === 'brunch' ? 'all' : 'brunch')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 select-none touch-manipulation active:scale-95 ${
              filterInvitation === 'brunch'
                ? 'bg-amber-700 text-white shadow-xs'
                : 'bg-orange-50 text-amber-900 border border-orange-200 hover:bg-orange-100'
            }`}
            title="Invités au Brunch du lendemain"
          >
            <span>🥐 Brunch</span>
            <span className="text-[10px] opacity-80 font-mono hidden sm:inline">({invitationStats.brunch.families} fam. / {invitationStats.brunch.guests} pers.)</span>
            <span className="text-[10px] opacity-80 font-mono sm:hidden">({invitationStats.brunch.families})</span>
          </button>
          <button
            onClick={() => setFilterInvitation(filterInvitation === 'repas' ? 'all' : 'repas')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 select-none touch-manipulation active:scale-95 ${
              filterInvitation === 'repas'
                ? 'bg-[#C4A475] text-[#13263B] font-bold shadow-xs'
                : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
            }`}
            title="Tous les invités au Dîner (avec ou sans Brunch)"
          >
            <span>🍽️ Dîner (total)</span>
            <span className="text-[10px] opacity-80 font-mono hidden sm:inline">({invitationStats.repas.families} fam. / {invitationStats.repas.guests} pers.)</span>
            <span className="text-[10px] opacity-80 font-mono sm:hidden">({invitationStats.repas.families})</span>
          </button>
          <button
            onClick={() => setFilterInvitation(filterInvitation === 'vin' ? 'all' : 'vin')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 select-none touch-manipulation active:scale-95 ${
              filterInvitation === 'vin'
                ? 'bg-[#13263B] text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
            }`}
            title="Tous les invités au Vin d'honneur"
          >
            <span>🍸 Vin total</span>
            <span className="text-[10px] opacity-80 font-mono hidden sm:inline">({invitationStats.vin.families} fam. / {invitationStats.vin.guests} pers.)</span>
            <span className="text-[10px] opacity-80 font-mono sm:hidden">({invitationStats.vin.families})</span>
          </button>
        </div>

        {/* Wedding Dinner Letters Summary Banner - Visible only for full admin */}
        {canSeeOptionalNotes && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-gradient-to-r from-amber-50/80 via-white to-rose-50/80 rounded-2xl border border-[#C4A475]/35 shadow-2xs">
            <div className="flex items-center gap-3">
              <span className="text-2xl select-none">💌</span>
              <div>
                <span className="text-xs font-bold text-[#13263B] block">
                  Mots des mariés pour les lettres personnalisées du dîner
                </span>
                <span className="text-[11px] text-[#5A5040] font-serif italic">
                  <strong>{lettersWrittenCount}</strong> rédigé(s) sur <strong>{dinnerConfirmedMembers.length}</strong> invité(s) confirmé(s) au dîner
                  {lettersMissingCount > 0 ? (
                    <span className="text-rose-700 font-semibold not-italic ml-1">
                      ({lettersMissingCount} lettre{lettersMissingCount > 1 ? 's' : ''} à rédiger)
                    </span>
                  ) : (
                    <span className="text-emerald-700 font-semibold not-italic ml-1">
                      — Toutes les lettres sont prêtes ! 🎉
                    </span>
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setFilterStatus(filterStatus === 'letters_missing' ? 'all' : 'letters_missing')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 select-none touch-manipulation active:scale-95 ${
                  filterStatus === 'letters_missing'
                    ? 'bg-rose-700 text-white shadow-xs'
                    : lettersMissingCount > 0
                    ? 'bg-rose-50 text-rose-800 border border-rose-300 hover:bg-rose-100'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
                title="Afficher uniquement les invités venant au dîner sans mot rédigé"
              >
                <span>✉️ À rédiger</span>
                <span className={`font-mono text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                  filterStatus === 'letters_missing' ? 'bg-white/20 text-white' : 'bg-rose-200 text-rose-900'
                }`}>
                  {lettersMissingCount}
                </span>
              </button>
              <button
                onClick={() => setFilterStatus(filterStatus === 'letters_done' ? 'all' : 'letters_done')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 select-none touch-manipulation active:scale-95 ${
                  filterStatus === 'letters_done'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-emerald-50 text-emerald-900 border border-emerald-200 hover:bg-emerald-100'
                }`}
                title="Afficher les invités dont le mot des mariés est déjà rédigé"
              >
                <span>✓ Rédigées</span>
                <span className={`font-mono text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                  filterStatus === 'letters_done' ? 'bg-white/20 text-white' : 'bg-emerald-200 text-emerald-900'
                }`}>
                  {lettersWrittenCount}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Query Results Cards List */}
        <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
          {filteredFamilies.length > 0 ? (
            filteredFamilies.map((fam) => {
              const attendingMembers = fam.members.filter((m) => m.isAttending);
              const absentMembers = fam.members.filter((m) => !m.isAttending);
              const isResponded = Boolean(
                fam.hasResponded ||
                fam.respondedAt ||
                fam.notes === 'has_responded' ||
                (fam.lastMessage && fam.lastMessage.trim().length > 0)
              );

              return (
                <div key={fam.id} className="p-4 bg-[#FAF7F2] rounded-2xl border border-slate-200/80 space-y-3">
                  {/* Family Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 pb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-display font-bold text-base text-[#13263B]">
                        Famille {fam.familyName} <span className="text-xs font-mono text-slate-400 font-normal">({fam.id})</span>
                      </h4>
                      {fam.email && (
                        <a href={`mailto:${fam.email}`} className="text-xs text-[#3B6FA0] hover:underline font-mono">
                          {fam.email}
                        </a>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-2 sm:mt-0">
                      {/* Quick Host Selector */}
                      <select
                        value={fam.invitedBy || ''}
                        onChange={(e) => handleUpdateFamilyHost(fam.id, e.target.value)}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                          fam.invitedBy === 'Valentine&Jean'
                            ? 'bg-blue-50 text-[#13263B] border-blue-200 hover:border-blue-400'
                            : fam.invitedBy === 'Anny&Marc'
                            ? 'bg-rose-50 text-rose-800 border-rose-200 hover:border-rose-400'
                            : fam.invitedBy === 'Anne&Visith'
                            ? 'bg-teal-50 text-teal-800 border-teal-200 hover:border-teal-400'
                            : 'bg-amber-100 text-amber-900 border-amber-300 hover:border-amber-500 font-bold'
                        }`}
                        title="Qui a invité cette famille ? Cliquez pour changer rapidement"
                      >
                        <option value="">Hôte : à définir</option>
                        <option value="Valentine&Jean">Valentine &amp; Jean</option>
                        <option value="Anny&Marc">Anny &amp; Marc</option>
                        <option value="Anne&Visith">Anne &amp; Visith</option>
                      </select>

                      {/* Quick Family Invitation Scope Selector */}
                      <select
                        value={
                          fam.members.length > 0 && fam.members.every(isMemberInvitedToVin) && fam.members.every(isMemberInvitedToRepas) && fam.members.every(isMemberInvitedToBrunch)
                            ? 'all_three'
                            : fam.members.length > 0 && fam.members.every(isMemberInvitedToVin) && fam.members.every(isMemberInvitedToRepas) && !fam.members.some(isMemberInvitedToBrunch)
                            ? 'vin_repas'
                            : fam.members.length > 0 && fam.members.every(isMemberInvitedToVin) && !fam.members.some(isMemberInvitedToRepas) && !fam.members.some(isMemberInvitedToBrunch)
                            ? 'vin_only'
                            : 'custom'
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'all_three') handleUpdateInvitation(fam.id, true, true, true);
                          else if (val === 'vin_repas') handleUpdateInvitation(fam.id, true, true, false);
                          else if (val === 'vin_only') handleUpdateInvitation(fam.id, true, false, false);
                          else if (val === 'custom') setEditingFamily(fam);
                        }}
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-300 bg-white hover:border-[#C4A475] transition-all cursor-pointer text-[#13263B]"
                        title="Périmètre d'invitation de la famille (cliquez pour changer ou configurer par membre)"
                      >
                        <option value="all_three">🍸🍽️🥐 Vin + Dîner + Brunch</option>
                        <option value="vin_repas">🍸🍽️ Vin + Dîner</option>
                        <option value="vin_only">🍸 Vin d'honneur seul</option>
                        <option value="custom">⚙️ Personnalisé par membre...</option>
                      </select>

                      {isResponded ? (
                        <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2.5 py-0.5 rounded-full font-sans">
                          ✓ Répondu {fam.respondedAt ? `le ${formatDate(fam.respondedAt)}` : ''} ({attendingMembers.length} présent(s) / {absentMembers.length} absent(s))
                        </span>
                      ) : (
                        <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2.5 py-0.5 rounded-full font-sans">
                          ⏳ En attente de réponse
                        </span>
                      )}
                      
                      <button onClick={() => setEditingFamily(fam)} className="p-1 text-slate-400 hover:text-[#3B6FA0] hover:bg-blue-50 rounded-lg transition-colors cursor-pointer" title="Modifier la famille et les invitations détaillées">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDeleteFamily(fam.id, fam.familyName)} className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer" title="Supprimer la famille">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Members breakdown grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {fam.members.map((m) => (
                      <div key={m.id} className="p-3 bg-white rounded-xl border border-slate-200/80 space-y-1.5 flex flex-col justify-between">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            {m.isBaby ? <Baby className="w-3.5 h-3.5 text-amber-600" /> : m.isChild ? <ChildIcon className="w-3.5 h-3.5 text-[#C4A475]" /> : <Users className="w-3.5 h-3.5 text-[#13263B]" />}
                            <span className="font-semibold text-[#13263B]">{m.firstName} {m.lastName}</span>
                            <span className="text-[9px] uppercase font-bold text-slate-400">({m.isBaby ? 'Bébé' : (m.isChild ? 'Enfant' : 'Adulte')})</span>
                          </div>

                          {isResponded ? (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              m.isAttending ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-400'
                            }`}>
                              {m.isAttending ? '✓ Présent' : '✗ Absent'}
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                              ⏳ Non confirmé
                            </span>
                          )}
                        </div>

                        {/* Scope d'invitation (qui est mis où) */}
                        <div className="text-[10px] text-slate-600 flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100">
                          <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Invité :</span>
                          <span
                            className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-medium ${
                              isMemberInvitedToVin(m)
                                ? 'bg-blue-50 text-blue-900 border border-blue-200'
                                : 'bg-slate-100 text-slate-300 line-through'
                            }`}
                            title={isMemberInvitedToVin(m) ? "Invité au Vin d'honneur" : "Non invité au Vin d'honneur"}
                          >
                            🍸 Vin
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-medium ${
                              isMemberInvitedToRepas(m)
                                ? 'bg-amber-50 text-amber-900 border border-amber-200'
                                : 'bg-slate-100 text-slate-300 line-through'
                            }`}
                            title={isMemberInvitedToRepas(m) ? "Invité au Repas de Noces (Dîner)" : "Non invité au Repas de Noces"}
                          >
                            🍽️ Dîner
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-medium ${
                              isMemberInvitedToBrunch(m)
                                ? 'bg-orange-50 text-orange-900 border border-orange-200'
                                : 'bg-slate-100 text-slate-300 line-through'
                            }`}
                            title={isMemberInvitedToBrunch(m) ? "Invité au Brunch" : "Non invité au Brunch"}
                          >
                            🥐 Brunch
                          </span>
                        </div>

                        {/* Réponse / Confirmation reçue (comment) */}
                        {isResponded ? (
                          <div className="text-[10px] flex items-center gap-1.5 flex-wrap pt-0.5">
                            <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Réponse :</span>
                            {m.isAttending ? (
                              <>
                                {isMemberInvitedToVin(m) && (
                                  <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-semibold ${m.events?.vinHonneur ? 'bg-[#13263B] text-white' : 'bg-slate-100 text-slate-400 line-through'}`}>
                                    Vin {m.events?.vinHonneur ? '✓' : '✗'}
                                  </span>
                                )}
                                {isMemberInvitedToRepas(m) && (
                                  <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-semibold ${m.events?.repasNoces ? 'bg-[#C4A475] text-white' : 'bg-slate-100 text-slate-400 line-through'}`}>
                                    Dîner {m.events?.repasNoces ? '✓' : '✗'}
                                  </span>
                                )}
                                {isMemberInvitedToBrunch(m) && (
                                  <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-semibold ${m.events?.brunchLendemain ? 'bg-amber-700 text-white' : 'bg-slate-100 text-slate-400 line-through'}`}>
                                    Brunch {m.events?.brunchLendemain ? '✓' : '✗'}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-[10px] font-medium text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                                Déclaré absent
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-[10px] text-amber-700/80 italic pt-0.5 flex items-center gap-1">
                            <span>⏳ Réponse en attente</span>
                          </div>
                        )}

                        {m.dietaryNotes && (
                          <div className="mt-1 text-[10px] text-amber-900 bg-amber-50 p-1.5 rounded border border-amber-200 flex items-center gap-1">
                            <Utensils className="w-3 h-3 shrink-0 text-amber-700" />
                            <span><strong>Régime :</strong> {m.dietaryNotes}</span>
                          </div>
                        )}

                        {/* Mot des mariés pour la lettre du dîner — Visible uniquement pour ADMIN_FULL_TOKEN */}
                        {canSeeOptionalNotes && (
                          <div className="mt-2 pt-2 border-t border-slate-100">
                            {m.weddingNote && m.weddingNote.trim() ? (
                              <div className="bg-[#FAF7F2] p-2.5 rounded-xl border border-[#C4A475]/35 space-y-1">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-serif italic font-semibold text-[#13263B] text-[11px] flex items-center gap-1.5">
                                    <span>💌 Mot des mariés (lettre) :</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingNoteMember({ member: m, familyName: fam.familyName, familyId: fam.id });
                                      setNoteText(m.weddingNote || '');
                                    }}
                                    className="text-[10px] text-[#3B6FA0] hover:text-[#13263B] font-semibold underline cursor-pointer"
                                  >
                                    Modifier
                                  </button>
                                </div>
                                <p className="font-serif italic text-slate-700 whitespace-pre-line text-xs leading-relaxed">
                                  « {m.weddingNote} »
                                </p>
                              </div>
                            ) : isMemberAttendingDinner(m) ? (
                              <div className="bg-rose-50/90 p-2 rounded-xl border border-rose-200 flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold text-rose-700 flex items-center gap-1">
                                  <span>⚠️ Mot lettre dîner non rédigé</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingNoteMember({ member: m, familyName: fam.familyName, familyId: fam.id });
                                    setNoteText('');
                                  }}
                                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold rounded-lg transition-colors cursor-pointer shadow-2xs shrink-0"
                                >
                                  + Rédiger le mot
                                </button>
                              </div>
                            ) : (
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingNoteMember({ member: m, familyName: fam.familyName, familyId: fam.id });
                                    setNoteText('');
                                  }}
                                  className="text-[10px] text-slate-400 hover:text-[#C4A475] italic cursor-pointer flex items-center gap-1 hover:underline"
                                >
                                  + Ajouter un mot des mariés
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Message if left — visible only for full admin */}
                  {canSeeOptionalNotes && fam.lastMessage && (
                    <div className="text-xs font-serif italic text-[#3B6FA0] bg-white p-2.5 rounded-xl border border-slate-200 flex items-start gap-2">
                      <MessageSquare className="w-3.5 h-3.5 text-[#C4A475] shrink-0 mt-0.5" />
                      <span>« {fam.lastMessage} »</span>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <p className="text-xs text-slate-500 font-serif italic text-center py-8">
              Aucun invité ne correspond à ces critères de recherche.
            </p>
          )}
        </div>
      </div>

      {/* 3.5 MESSAGES RECEIVED THROUGH THE CONTACT FORM (VISIBLE UNIQUEMENT POUR L'ADMIN COMPLET) */}
      {canSeeOptionalNotes && (
        <div className="bg-white rounded-3xl border border-[#3B6FA0]/15 p-6 space-y-5 shadow-xs">
          <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="font-display text-xl text-[#13263B] font-semibold flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-[#C4A475]" />
                <span>Messages reçus ({contactMessages.length})</span>
              </h3>
              <p className="text-xs text-[#5A5040] font-serif italic">
                Envoyés depuis le formulaire « Écrire aux Mariés ». Répondez par e-mail à l'adresse indiquée.
              </p>
            </div>
            {contactMessages.length > 0 && (
              <button
                onClick={async () => {
                  if (window.confirm('Voulez-vous vraiment effacer tous les messages reçus de la boîte de contact ?')) {
                    try {
                      await fetch('/api/admin/clear-contact-messages', { method: 'POST', headers: adminHeaders() });
                      fetchContactMessages();
                      alert('Les messages reçus ont été effacés avec succès.');
                    } catch (e) {
                      console.error('Erreur effacement messages:', e);
                    }
                  }
                }}
                className="px-3.5 py-1.5 text-xs text-red-600 hover:text-white hover:bg-red-600 border border-red-200 hover:border-red-600 rounded-xl font-medium transition-all cursor-pointer self-start sm:self-auto"
              >
                Effacer les messages reçus
              </button>
            )}
          </div>

          {contactMessages.length > 0 ? (
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {contactMessages.map((msg) => (
                <div key={msg.id} className="p-4 bg-[#FAF7F2] rounded-2xl border border-slate-200 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display font-semibold text-[#13263B]">{msg.name}</span>
                      <a href={`mailto:${msg.email}`} className="text-xs font-mono text-[#3B6FA0] hover:text-[#13263B] underline">
                        {msg.email}
                      </a>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">{formatDate(msg.created_at)}</span>
                  </div>
                  {msg.subject && (
                    <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-[#C4A475]">
                      {CONTACT_SUBJECT_LABELS[msg.subject] || msg.subject}
                    </span>
                  )}
                  <p className="text-sm text-[#13263B] whitespace-pre-line">{msg.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 font-serif italic text-center py-8">
              Aucun message reçu pour le moment.
            </p>
          )}
        </div>
      )}

      {/* 4. FILE DOWNLOAD BUTTONS & RESET ACTION */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <a
          href={`/api/admin/export-recap-excel?host=all&key=${encodeURIComponent(getAdminToken())}`}
          download="Recapitulatif_Invites_Tous.xlsx"
          className="p-5 bg-[#13263B] hover:bg-[#C4A475] text-white hover:text-[#13263B] rounded-2xl font-sans text-xs font-semibold flex items-center justify-between group transition-all shadow-2xs cursor-pointer"
          title="Télécharger l'export Excel avec mise en forme propre, couleurs (vert/jaune/bleu/gris/rouge) et segmentation par foyer"
        >
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-6 h-6 text-[#C4A475] group-hover:text-[#13263B]" />
            <div className="text-left">
              <span className="block font-bold text-sm">Export Excel Hebdo</span>
              <span className="text-[11px] font-serif italic opacity-80">
                Fichier stylisé (vendredi 20h)
              </span>
            </div>
          </div>
          <Download className="w-5 h-5 group-hover:translate-y-0.5 transition-transform" />
        </a>

        <button
          onClick={() => {
            let csv = "ID Famille,Famille,Invité par,Prénom,Nom,Statut,Âge,Invité Vin,Invité Dîner,Invité Brunch,Présent,Présent Vin,Présent Dîner,Présent Brunch,Régime/Allergies,Email\n";
            families.forEach((fam) => {
              const hostLabel = fam.invitedBy === 'Valentine&Jean' ? 'Valentine & Jean' : fam.invitedBy === 'Anny&Marc' ? 'Anny & Marc' : fam.invitedBy === 'Anne&Visith' ? 'Anne & Visith' : (fam.invitedBy || 'Non défini');
              fam.members.forEach((m: any) => {
                const invVin = isMemberInvitedToVin(m) ? "Oui" : "Non";
                const invRepas = isMemberInvitedToRepas(m) ? "Oui" : "Non";
                const invBrunch = isMemberInvitedToBrunch(m) ? "Oui" : "Non";
                csv += `"${fam.id}","${fam.familyName}","${hostLabel}","${m.firstName}","${m.lastName}","${
                  m.isBaby ? "Bébé" : (m.isChild ? "Enfant" : "Adulte")
                }","${m.age || ""}","${invVin}","${invRepas}","${invBrunch}","${m.isAttending ? "Oui" : "Non"}","${
                  m.events?.vinHonneur ? "Oui" : "Non"
                }","${m.events?.repasNoces ? "Oui" : "Non"}","${
                  m.events?.brunchLendemain ? "Oui" : "Non"
                }","${m.dietaryNotes || ""}","${fam.email || ""}"\n`;
              });
            });

            const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", "liste_invites_mariage.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}
          className="p-5 bg-white border border-[#3B6FA0]/20 hover:border-[#13263B] text-[#13263B] rounded-2xl font-sans text-xs font-semibold flex items-center justify-between group transition-all shadow-2xs cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-6 h-6 text-[#3B6FA0]" />
            <div className="text-left">
              <span className="block font-bold text-sm">Exporter en CSV</span>
              <span className="text-[11px] font-serif italic text-[#5A5040]">
                Pour le traiteur
              </span>
            </div>
          </div>
          <Download className="w-5 h-5 text-[#3B6FA0] group-hover:translate-y-0.5 transition-transform" />
        </button>

        <a
          href={`/api/admin/download-db?key=${encodeURIComponent(getAdminToken())}`}
          download="wedding.db"
          className="p-5 bg-white border border-[#3B6FA0]/20 hover:border-[#13263B] text-[#13263B] rounded-2xl font-sans text-xs font-semibold flex items-center justify-between group transition-all shadow-2xs cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <Database className="w-6 h-6 text-[#3B6FA0]" />
            <div className="text-left">
              <span className="block font-bold text-sm">Télécharger wedding.db</span>
              <span className="text-[11px] text-[#5A5040] font-serif italic">
                Sauvegarde binaire
              </span>
            </div>
          </div>
          <Download className="w-5 h-5 text-[#3B6FA0] group-hover:translate-y-0.5 transition-transform" />
        </a>

        <button
          onClick={async () => {
            if (window.confirm('Voulez-vous vraiment effacer toutes les réponses reçues et réinitialiser la base de données ?')) {
              try {
                clearLocalStorageRSVPs();
                await fetch('/api/admin/clear-rsvps', { method: 'POST', headers: adminHeaders() }).catch(() => {});
                fetchFamilies();
                fetchStats();
                alert('Toutes les réponses ont été réinitialisées avec succès !');
              } catch (e) {
                console.error('Erreur réinitialisation:', e);
              }
            }
          }}
          className="p-5 bg-red-50 hover:bg-red-600 border border-red-200 hover:border-red-600 text-red-700 hover:text-white rounded-2xl font-sans text-xs font-semibold flex items-center justify-between group transition-all shadow-2xs cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <RefreshCw className="w-6 h-6 text-red-500 group-hover:text-white" />
            <div className="text-left">
              <span className="block font-bold text-sm">Effacer les réponses</span>
              <span className="text-[11px] opacity-80 font-serif italic">
                Réinitialiser la base
              </span>
            </div>
          </div>
          <X className="w-5 h-5 group-hover:scale-110 transition-transform" />
        </button>
      </div>

{editingFamily && (
        <AdminEditFamilyModal
          family={editingFamily}
          onClose={() => setEditingFamily(null)}
          onSuccess={() => {
            setEditingFamily(null);
            fetchFamilies();
            fetchStats();
          }}
          adminHeaders={adminHeaders}
        />
      )}

      {/* Modal d'édition du Mot des mariés (accessible uniquement avec ADMIN_FULL_TOKEN) */}
      {editingNoteMember && (
        <div className="fixed inset-0 bg-[#13263B]/70 backdrop-blur-xs flex items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl relative text-left my-auto flex flex-col border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
            <div className="h-1.5 bg-gradient-to-r from-[#13263B] via-[#C4A475] to-[#13263B] shrink-0" />
            
            <div className="p-5 sm:p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[10px] tracking-widest uppercase font-serif font-bold text-[#C4A475] block mb-0.5">
                    Lettre personnalisée du dîner
                  </span>
                  <h4 className="font-display text-xl text-[#13263B] font-bold">
                    {editingNoteMember.member.firstName} {editingNoteMember.member.lastName}
                  </h4>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-slate-500 font-sans">
                      Famille {editingNoteMember.familyName}
                    </span>
                    {isMemberAttendingDinner(editingNoteMember.member) ? (
                      <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                        🍽️ Confirmé au dîner
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                        {editingNoteMember.member.isAttending ? '✓ Présent' : '⏳ Non confirmé'}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingNoteMember(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer transition-colors"
                >
                  ✕
                </button>
              </div>

              <p className="text-xs text-[#5A5040] font-serif italic">
                Ce mot apparaîtra dans la dernière colonne de l'export Excel du vendredi pour imprimer votre lettre de table personnalisée.
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Mot des mariés :
                </label>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={5}
                  placeholder="Ex : Chère Éloïse, quel bonheur de t'avoir parmi nous pour célébrer notre mariage ! Un immense merci pour ton soutien et ta présence à notre table..."
                  className="w-full p-3 text-xs text-[#13263B] font-sans border border-slate-300 rounded-xl focus:outline-none focus:border-[#C4A475] focus:ring-1 focus:ring-[#C4A475] bg-[#FAF7F2] resize-y leading-relaxed"
                  autoFocus
                />
                <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1">
                  <span>{noteText.trim().split(/\s+/).filter(Boolean).length} mot(s)</span>
                  <span>{noteText.length} caractère(s)</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                {noteText.trim() ? (
                  <button
                    type="button"
                    onClick={() => setNoteText('')}
                    className="text-xs text-rose-600 hover:text-rose-800 font-medium cursor-pointer"
                  >
                    Effacer le mot
                  </button>
                ) : <span />}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingNoteMember(null)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-[#13263B] bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveWeddingNote}
                    disabled={savingNote}
                    className={`px-4 py-2 text-xs font-bold rounded-xl text-white transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs ${
                      noteSaveSuccess
                        ? 'bg-emerald-600'
                        : 'bg-[#13263B] hover:bg-[#C4A475] hover:text-[#13263B]'
                    }`}
                  >
                    {savingNote ? (
                      <span>Enregistrement...</span>
                    ) : noteSaveSuccess ? (
                      <span>✓ Enregistré !</span>
                    ) : (
                      <span>Enregistrer le mot</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

