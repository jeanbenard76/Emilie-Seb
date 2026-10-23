/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, X, Search, User, Baby, Footprints, Heart, Users, ChevronRight, CheckCircle2, AlertCircle, Database, Download, FileSpreadsheet, ShieldCheck, RefreshCw, MessageSquare, Utensils, Clock, Mail } from 'lucide-react';
import ChildIcon from './ChildIcon';
import { GuestFamily, FamilyMember } from '../types';
import { getStoredFamilies, saveRSVPToLocalStorage } from '../utils/rsvpStorage';

interface RSVPFormProps {
  onNavigateToContact?: () => void;
}

export default function RSVPForm({ onNavigateToContact }: RSVPFormProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GuestFamily[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedFamily, setSelectedFamily] = useState<GuestFamily | null>(null);
  // True when a previous answer given on this device was restored into the form
  const [restoredAnswers, setRestoredAnswers] = useState(false);

  // Editable members list for the selected family
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNoEmailModal, setShowNoEmailModal] = useState(false);
  const [showBrunchModal, setShowBrunchModal] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');

  // Fermer la pop-up brunch avec la touche Échap
  useEffect(() => {
    if (!showBrunchModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowBrunchModal(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showBrunchModal]);

  // Admin dashboard state
  const [showAdmin, setShowAdmin] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [allRSVPs, setAllRSVPs] = useState<any[]>([]);

  // Load live stats on component mount
  useEffect(() => {
    fetchStats();
    fetchRSVPs();
  }, []);

  // Households are searched on the server: the guest list is never sent to the browser
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/families/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const data = res.ok ? await res.json() : [];
        setSuggestions(Array.isArray(data) ? data : []);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.log('Erreur récupération statistiques API');
    }
  };

  const fetchRSVPs = async () => {
    try {
      const res = await fetch('/api/rsvps');
      if (res.ok) {
        const data = await res.json();
        setAllRSVPs(data);
      }
    } catch (err) {
      console.log('Erreur récupération des RSVPs');
    }
  };

  // Handle selecting a family from suggestions database
  const handleSelectFamily = (fam: GuestFamily) => {
    // The server never sends previous answers: restore them only if they were given on this device
    const previous = fam.hasResponded ? getStoredFamilies().find((f) => f.id === fam.id) : undefined;

    setSelectedFamily(fam);
    setRestoredAnswers(Boolean(previous));
    setSearchQuery(`Famille ${fam.familyName}`);
    setEmail(previous?.email || '');
    setMessage('');

    const sanitizedMembers = fam.members.map((m) => {
      const inv = m.invitedTo || { vinHonneur: true, repasNoces: true, brunchLendemain: true };
      const prev = previous?.members.find((p) => p.id === m.id);
      return {
        ...m,
        isAttending: prev ? Boolean(prev.isAttending) : true,
        invitedTo: inv,
        events: {
          vinHonneur: inv.vinHonneur !== false ? (prev ? Boolean(prev.events?.vinHonneur) : true) : false,
          repasNoces: inv.repasNoces ? (prev ? Boolean(prev.events?.repasNoces) : true) : false,
          brunchLendemain: inv.brunchLendemain ? (prev ? Boolean(prev.events?.brunchLendemain) : true) : false,
        },
        dietaryNotes: prev?.dietaryNotes || '',
      };
    });

    setMembers(sanitizedMembers);
    setShowSuggestions(false);

    // Si la famille est invitée au brunch, afficher la pop-up sobre d'information
    const isInvitedToBrunch = sanitizedMembers.some((m) => Boolean(m.invitedTo?.brunchLendemain));
    if (isInvitedToBrunch) {
      setShowBrunchModal(true);
    }
  };

  // Start fresh manual family input if name not found in DB
  const handleCreateCustomFamily = () => {
    const cleanName = searchQuery.trim() || 'Invité';
    setSelectedFamily({
      id: `custom-${Date.now()}`,
      familyName: cleanName,
      members: [],
    });
    setMembers([
      {
        id: `m-custom-1`,
        firstName: cleanName,
        lastName: '',
        isChild: false,
        isAttending: true,
        events: { vinHonneur: true, repasNoces: true, brunchLendemain: true },
      },
    ]);
    setEmail('');
    setMessage('');
    setShowSuggestions(false);
  };

  // Toggle individual attendance
  const toggleAttendance = (memberId: string) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, isAttending: !m.isAttending } : m))
    );
  };

  // Set explicit attendance status (Présent / Absent)
  const setMemberAttendance = (memberId: string, status: boolean) => {
    setMembers((prev) =>
      prev.map((m) => {
        if (m.id === memberId) {
          if (status === true && !m.isAttending) {
            return {
              ...m,
              isAttending: status,
              events: {
                vinHonneur: m.invitedTo?.vinHonneur !== false,
                repasNoces: m.invitedTo?.repasNoces === true,
                brunchLendemain: m.invitedTo?.brunchLendemain === true,
              }
            };
          }
          return { ...m, isAttending: status };
        }
        return m;
      })
    );
  };

  // Toggle individual event participation
  const toggleEvent = (memberId: string, eventKey: 'vinHonneur' | 'repasNoces' | 'brunchLendemain') => {
    setMembers((prev) =>
      prev.map((m) =>
        m.id === memberId
          ? {
              ...m,
              events: {
                ...m.events,
                [eventKey]: !m.events[eventKey],
              },
            }
          : m
      )
    );
  };

  // Update dietary notes for a member
  const updateDietary = (memberId: string, notes: string) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, dietaryNotes: notes } : m))
    );
  };

  // Batch toggle all members
  const batchSetAttendance = (status: boolean) => {
    setMembers((prev) => prev.map((m) => {
      if (status === true && !m.isAttending) {
        return {
          ...m,
          isAttending: status,
          events: {
            vinHonneur: m.invitedTo?.vinHonneur !== false,
            repasNoces: m.invitedTo?.repasNoces === true,
            brunchLendemain: m.invitedTo?.brunchLendemain === true,
          }
        };
      }
      return { ...m, isAttending: status };
    }));
  };

  // Execute RSVP submission
  const executeSubmit = async (finalEmail: string) => {
    if (!selectedFamily || members.length === 0) return;

    const payload = {
      familyId: selectedFamily.id,
      familyName: selectedFamily.familyName,
      email: finalEmail,
      members,
      message,
    };

    setIsSubmitting(true);

    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("Une erreur est survenue lors de l'enregistrement de votre réponse.");
      }

      // Save to localStorage: lets this device restore the answers on a later update
      saveRSVPToLocalStorage(payload);

      await fetchStats();
      await fetchRSVPs();
      setSubmittedEmail(finalEmail);
      setIsSubmitted(true);
    } catch (err: any) {
      console.error('Erreur lors de l’envoi du RSVP API', err);
      alert(err.message || "Une erreur est survenue lors de l'envoi. Veuillez réessayer ou nous contacter.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit RSVP to SQLite wedding.db backend or fallback storage
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedFamily || members.length === 0) {
      alert("Veuillez d'abord rechercher et sélectionner votre foyer dans la liste des invités.");
      return;
    }

    const trimmedEmail = email.trim();
    if (trimmedEmail && !trimmedEmail.includes('@')) {
      alert("Veuillez renseigner une adresse email valide ou laisser le champ vide pour continuer sans email.");
      return;
    }

    // Si aucun email n'est renseigné, demander confirmation via la pop-up
    if (!trimmedEmail) {
      setShowNoEmailModal(true);
      return;
    }

    await executeSubmit(trimmedEmail);
  };


  const attendingAdults = members.filter((m) => m.isAttending && !m.isChild).length;
  const attendingChildren = members.filter((m) => m.isAttending && m.isChild).length;

  return (
    <div className="w-full max-w-5xl 2xl:max-w-6xl mx-auto px-4 lg:px-8 py-4 sm:py-8 pb-12 sm:pb-16" id="rsvp-section">
      
      {/* Editorial Header */}
      <div className="text-center mb-6 sm:mb-8 xl:mb-12">
        <span className="text-[10px] sm:text-[11px] tracking-[0.3em] font-sans uppercase font-bold text-[#C4A475] block mb-3">
          RÉPONSE SOUHAITÉE AVANT LE 15 FÉVRIER 2027
        </span>
        <h2 className="font-script text-[clamp(2.5rem,5vw,4rem)] xl:text-[4.5rem] 2xl:text-[5rem] text-[#13263B] leading-tight pt-2">
          Confirmation de Présence
        </h2>
        <div className="w-16 h-[1px] bg-[#C4A475] mx-auto my-3 sm:my-4" />
        <p className="font-serif italic text-[#3B6FA0] text-xs sm:text-base xl:text-lg max-w-xl xl:max-w-2xl 2xl:max-w-3xl mx-auto leading-relaxed">
          Afin d’organiser au mieux notre réception au Manoir d'Auffay, merci d’indiquer ci-dessous les membres de votre foyer qui participeront à notre grand jour.
        </p>
      </div>

      {/* Main Card Container */}
      <div className="border-0 rounded-3xl p-1 sm:p-4 relative">

        <AnimatePresence mode="wait">
          {isSubmitted ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="py-8 text-center space-y-6"
            >
              <div className="w-16 h-16 rounded-full bg-white border border-[#C4A475] mx-auto flex items-center justify-center text-[#13263B]">
                <CheckCircle2 className="w-8 h-8 text-[#C4A475]" />
              </div>

              <div>
                <h3 className="font-display text-2xl sm:text-3xl text-[#13263B] mb-2">
                  Merci infiniment !
                </h3>
                <p className="text-sm font-serif italic text-[#5A5040] max-w-md mx-auto">
                  Votre réponse pour la {selectedFamily ? `Famille ${selectedFamily.familyName}` : 'famille'} a bien été enregistrée.
                </p>
              </div>

              {/* Summary breakdown box */}
              <div className="bg-white/90 backdrop-blur-sm shadow-sm border border-[#3B6FA0]/15 rounded-2xl p-5 max-w-md mx-auto text-left space-y-3">
                <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wider text-[#13263B] border-b border-[#3B6FA0]/10 pb-2">
                  <span className="leading-tight">Récapitulatif des confirmations</span>
                  <span className="text-[#C4A475] whitespace-nowrap shrink-0">
                    {attendingAdults + attendingChildren} Présent(s)
                  </span>
                </div>


                <div className={`${submittedEmail ? 'space-y-2' : 'space-y-3'} text-xs`}>
                  {members.map((m) => {
                    const attendingEvents: string[] = [];
                    const declinedEvents: string[] = [];
                    if (m.isAttending) {
                      if (m.invitedTo?.vinHonneur !== false) {
                        if (m.events?.vinHonneur) attendingEvents.push("Vin d'Honneur");
                        else declinedEvents.push("Vin d'Honneur");
                      }
                      if (m.invitedTo?.repasNoces !== false) {
                        if (m.events?.repasNoces) attendingEvents.push("Repas de Noces");
                        else declinedEvents.push("Repas de Noces");
                      }
                      if (m.invitedTo?.brunchLendemain !== false) {
                        if (m.events?.brunchLendemain) attendingEvents.push("Brunch");
                        else declinedEvents.push("Brunch");
                      }
                    }

                    return (
                      <div key={m.id} className={`py-1 border-b border-dashed border-slate-200 last:border-0 ${submittedEmail ? '' : 'space-y-1 pb-2'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {m.isBaby ? (
                              <Baby className="w-3.5 h-3.5 text-amber-600" />
                            ) : m.isChild ? (
                              <ChildIcon className="w-3.5 h-3.5 text-[#C4A475]" />
                            ) : (
                              <User className="w-3.5 h-3.5 text-[#13263B]" />
                            )}
                            <span className="font-medium text-[#13263B]">
                              {m.firstName} {m.lastName}
                            </span>
                            <span className={`text-[9px] px-1.5 py-0.2 rounded-full uppercase ${
                              m.isBaby 
                                ? 'bg-amber-100 text-amber-800 font-semibold' 
                                : m.isChild 
                                  ? 'bg-[#C4A475]/20 text-[#8B6B38]' 
                                  : 'bg-[#13263B]/10 text-[#13263B]'
                            }`}>
                              {m.isBaby ? 'Bébé' : (m.isChild ? 'Enfant' : 'Adulte')}
                            </span>
                          </div>

                          <span className={`font-semibold text-[11px] ${m.isAttending ? 'text-emerald-700' : 'text-slate-400'}`}>
                            {m.isAttending ? '✓ Présent(e)' : '✗ Absent(e)'}
                          </span>
                        </div>

                        {/* Récapitulatif détaillé uniquement si AUCUN email n'a été renseigné */}
                        {!submittedEmail && m.isAttending && (
                          <div className="pl-6 text-[11px] text-[#5A5040] space-y-0.5">
                            {attendingEvents.length > 0 && (
                              <p>
                                <span className="text-[#13263B] font-medium">Présence :</span> {attendingEvents.join(', ')}
                              </p>
                            )}
                            {declinedEvents.length > 0 && (
                              <p className="text-slate-500">
                                <span className="text-[#13263B] font-medium">Non présent :</span> {declinedEvents.join(', ')}
                              </p>
                            )}
                            {m.dietaryNotes && m.dietaryNotes.trim() && (
                              <p>
                                <span className="font-medium text-[#13263B]">Régime particulier :</span>{' '}
                                <span className="text-[#5A5040]">{m.dietaryNotes.trim()}</span>
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Message joint affiché si pas d'email */}
                {!submittedEmail && message && message.trim() && (
                  <div className="pt-2 border-t border-slate-100 text-[11px] text-[#5A5040]">
                    <span className="font-semibold text-[#13263B]">Message joint :</span>{' '}
                    <span className="italic text-slate-600">« {message.trim()} »</span>
                  </div>
                )}
              </div>

              {/* Rappel présidentielles */}
              <div className="bg-[#FAF7F2] border border-[#C4A475]/35 rounded-2xl p-4 max-w-md mx-auto text-xs text-[#5A5040] font-sans leading-relaxed text-center sm:text-left">
                <p>
                  <strong>Petit rappel :</strong> Pensez à faire votre procuration si nécessaire pour le 1<sup>er</sup> tour des élections présidentielles 2027, cela tombe le même week-end !
                </p>
              </div>

              <button
                onClick={() => {
                  setIsSubmitted(false);
                  setSelectedFamily(null);
                  setSearchQuery('');
                  setMembers([]);
                  setEmail('');
                  setMessage('');
                  setSubmittedEmail('');
                  setShowBrunchModal(false);
                }}
                className="px-6 py-2.5 border border-[#13263B]/30 hover:border-[#13263B] text-[#13263B] text-xs uppercase tracking-wider font-semibold rounded-full transition-all cursor-pointer"
              >
                Saisir une autre réponse
              </button>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-8">
              
              {/* STEP 1: Search Name / Database Lookup */}
              <div className="space-y-2 relative">
                <label className="block text-[11px] font-sans font-bold uppercase tracking-wider text-[#13263B]">
                  1. RECHERCHEZ VOTRE NOM OU PRÉNOM (LISTE D'INVITÉS) *
                </label>
                
                <div className="relative">
                  <Search className="w-4 h-4 text-[#3B6FA0] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSuggestions(true);
                      if (!e.target.value) {
                        setSelectedFamily(null);
                        setMembers([]);
                        setEmail('');
                        setMessage('');
                        setShowBrunchModal(false);
                      }
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                      }
                    }}
                    placeholder="Tapez votre nom (ex. Bénard, Chem-Lenhof, Dubois, Martin...)"
                    className="w-full pl-10 pr-4 py-3 bg-white border border-[#3B6FA0]/20 rounded-2xl text-xs text-[#13263B] font-sans focus:outline-none focus:border-[#C4A475] shadow-sm transition-colors"
                  />
                </div>

                {/* Database Suggestion Dropdown */}
                {showSuggestions && searchQuery.trim().length >= 3 && (
                  <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-[#3B6FA0]/20 rounded-2xl shadow-lg max-h-[260px] overflow-y-auto divide-y divide-slate-100">
                    {suggestions.length > 0 ? (
                      suggestions.map((fam) => (
                        <div
                          key={fam.id}
                          onClick={() => handleSelectFamily(fam)}
                          className="p-3.5 hover:bg-[#FAF7F2] cursor-pointer transition-colors flex items-center justify-between gap-2 group"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 sm:gap-2">
                              <Users className="w-4 h-4 text-[#C4A475] shrink-0 hidden sm:block" />
                              <span className="font-display font-semibold text-[13px] sm:text-sm text-[#13263B] truncate">
                                Famille {fam.familyName}
                              </span>
                              {fam.hasResponded && (
                                <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 sm:px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap">
                                  ✓ Déjà répondu
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] sm:text-xs text-[#5A5040] font-sans italic mt-0.5 sm:ml-6 truncate">
                              {fam.members.map((m) => `${m.firstName}${m.isChild ? ' (enfant)' : ''}`).join(', ')}
                            </p>
                          </div>
                          
                          <div className="shrink-0 flex items-center">
                            <span className="text-[10px] sm:text-xs font-semibold text-[#3B6FA0] group-hover:translate-x-1 transition-transform flex items-center gap-0.5 sm:gap-1 whitespace-nowrap">
                              <span>{fam.hasResponded ? 'Mettre à jour' : 'Sélectionner'}</span>
                              <ChevronRight className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                            </span>
                          </div>
                        </div>
                      ))
                    ) : isSearching ? (
                      <div className="p-4 text-xs text-[#5A5040] font-sans italic flex items-center gap-2">
                        <Search className="w-4 h-4 text-[#C4A475]" />
                        <span>Recherche en cours…</span>
                      </div>
                    ) : (
                      <div
                        onClick={handleCreateCustomFamily}
                        className="p-4 hover:bg-[#FAF7F2] cursor-pointer transition-colors text-xs text-[#13263B] flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-[#C4A475]" />
                          <span>Nom non répertorié. Créer un foyer pour <strong>&ldquo;{searchQuery}&rdquo;</strong></span>
                        </div>
                        <span className="font-semibold text-[#3B6FA0] uppercase text-[10px]">Valider ➔</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* BANNÈRE RAPPEL : SI LE FOYER A DÉJÀ RÉPONDU */}
              {selectedFamily?.hasResponded && (
                <div className="bg-white/90 backdrop-blur-sm border border-[#C4A475]/50 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-[#C4A475]/20 text-[#C4A475] flex items-center justify-center shrink-0 border border-[#C4A475]/30 mt-0.5">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-display font-semibold text-base text-[#13263B]">
                          Vous avez déjà répondu pour la Famille {selectedFamily.familyName} !
                        </h4>
                      </div>
                      <p className="text-xs font-serif italic text-[#5A5040] mt-0.5 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#3B6FA0]" />
                        <span>
                          {selectedFamily.respondedAt
                            ? `Dernière mise à jour le ${new Date(selectedFamily.respondedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                            : 'Réponse déjà enregistrée dans la base'}
                        </span>
                      </p>
                      <p className="text-xs font-sans font-medium text-[#3B6FA0] mt-1.5">
                        {restoredAnswers
                          ? 'Vous pouvez encore modifier vos choix ci-dessous et enregistrer votre mise à jour.'
                          : 'Pour protéger vos données, votre réponse précédente n’est pas réaffichée. Votre mise à jour la remplacera : pensez à indiquer de nouveau les éventuels régimes ou allergies.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: FAMILY MEMBERS ATTENDANCE MATRIX */}
              {(selectedFamily || members.length > 0) && (
                <div className="space-y-6 pt-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#3B6FA0]/15 pb-3">
                    <div>
                      <h3 className="font-display text-2xl text-[#13263B]">
                        Membres de la Famille ({members.length})
                      </h3>
                      <p className="text-xs text-[#5A5040] font-sans">
                        Cochez individuellement la présence de chaque adulte et enfant.
                      </p>
                    </div>

                    {/* Batch Actions */}
                    {/* Batch Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => batchSetAttendance(true)}
                        className="px-3 py-1.5 bg-[#FAF7F2] hover:bg-[#F2ECE1] border border-[#3B6FA0]/20 text-[#13263B] text-[11px] font-sans font-medium rounded-lg cursor-pointer transition-colors"
                      >
                        Tous présents
                      </button>
                      <button
                        type="button"
                        onClick={() => batchSetAttendance(false)}
                        className="px-3 py-1.5 bg-[#FAF7F2] hover:bg-[#F2ECE1] border border-[#3B6FA0]/20 text-[#13263B] text-[11px] font-sans font-medium rounded-lg cursor-pointer transition-colors"
                      >
                        Tous absents
                      </button>
                    </div>
                  </div>

                  {/* Individual Members Cards */}
                  <div className="space-y-4">
                    {members.map((member) => (
                      <div
                        key={member.id}
                        className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                          member.isAttending
                            ? 'bg-white/95 backdrop-blur-sm border-[#3B6FA0]/30 shadow-sm'
                            : 'bg-white/70 backdrop-blur-sm border-slate-200'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                          
                          {/* Member name & Badge */}
                          <div className="flex items-center gap-2.5">
                            <div className={`p-2 rounded-xl ${
                              member.isBaby 
                                ? 'bg-amber-100 text-amber-700' 
                                : member.isChild 
                                  ? 'bg-[#C4A475]/20 text-[#8B6B38]' 
                                  : 'bg-[#13263B]/10 text-[#13263B]'
                            }`}>
                              {member.isBaby ? (
                                <Baby className="w-4 h-4" />
                              ) : member.isChild ? (
                                <ChildIcon className="w-4 h-4" />
                              ) : (
                                <User className="w-4 h-4" />
                              )}
                            </div>

                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-display text-lg text-[#13263B] font-semibold">
                                  {member.firstName} {member.lastName}
                                </span>
                                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                                  member.isBaby 
                                    ? 'bg-amber-100 text-amber-800' 
                                    : member.isChild 
                                      ? 'bg-[#C4A475]/20 text-[#8B6B38]' 
                                      : 'bg-[#13263B]/10 text-[#13263B]'
                                }`}>
                                  {member.isBaby ? 'Bébé' : (member.isChild ? 'Enfant' : 'Adulte')}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Radio Buttons (Présent / Absent) */}
                          <div
                            role="radiogroup"
                            aria-label={`Présence de ${member.firstName}`}
                            className="flex items-center gap-5 sm:gap-6 py-1"
                          >
                            {/* Option Présent(e) */}
                            <label
                              onClick={() => setMemberAttendance(member.id, true)}
                              className="flex items-center gap-2.5 cursor-pointer select-none group"
                            >
                              <span
                                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors shrink-0 ${
                                  member.isAttending
                                    ? 'border-[#13263B]'
                                    : 'border-slate-300 group-hover:border-slate-400 bg-white'
                                }`}
                              >
                                {member.isAttending && (
                                  <span className="w-2.5 h-2.5 rounded-full bg-[#13263B]" />
                                )}
                              </span>
                              <span className={`text-xs sm:text-sm font-sans transition-colors ${
                                member.isAttending ? 'font-semibold text-[#13263B]' : 'text-slate-500 group-hover:text-slate-700'
                              }`}>
                                Présent(e)
                              </span>
                            </label>

                            {/* Option Absent(e) */}
                            <label
                              onClick={() => setMemberAttendance(member.id, false)}
                              className="flex items-center gap-2.5 cursor-pointer select-none group"
                            >
                              <span
                                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors shrink-0 ${
                                  !member.isAttending
                                    ? 'border-[#13263B]'
                                    : 'border-slate-300 group-hover:border-slate-400 bg-white'
                                }`}
                              >
                                {!member.isAttending && (
                                  <span className="w-2.5 h-2.5 rounded-full bg-[#13263B]" />
                                )}
                              </span>
                              <span className={`text-xs sm:text-sm font-sans transition-colors ${
                                !member.isAttending ? 'font-semibold text-[#13263B]' : 'text-slate-500 group-hover:text-slate-700'
                              }`}>
                                Absent(e)
                              </span>
                            </label>
                          </div>
                        </div>

                        {/* Events checkboxes if attending */}
                        {member.isAttending && (
                          <div className="mt-3 pt-3 border-t border-[#3B6FA0]/10 space-y-3">
                            <span className="block text-[10px] font-sans font-bold uppercase tracking-wider text-[#13263B]">
                              Événements auxquels participe {member.firstName} :
                            </span>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                              {/* Vin d'honneur */}
                              {member.invitedTo?.vinHonneur !== false && (
                                <label className={`flex items-center gap-2 p-2 bg-white rounded-xl border border-[#3B6FA0]/15 cursor-pointer hover:bg-[#FAF7F2] transition-colors ${
                                  !(member.events?.vinHonneur ?? true) ? 'bg-slate-50 border-slate-200 opacity-60' : ''
                                }`}>
                                  <input
                                    type="checkbox"
                                    checked={member.events?.vinHonneur ?? true}
                                    onChange={() => toggleEvent(member.id, 'vinHonneur')}
                                    className="accent-[#C4A475] rounded"
                                  />
                                  <span className={`text-[11px] font-medium transition-all ${
                                    !(member.events?.vinHonneur ?? true) ? 'line-through text-slate-400' : 'text-[#13263B]'
                                  }`}>
                                    Vin d'Honneur (18h00)
                                  </span>
                                </label>
                              )}

                              {/* Repas de Noces */}
                              {member.invitedTo?.repasNoces !== false && (
                                <label className={`flex items-center gap-2 p-2 bg-white rounded-xl border border-[#3B6FA0]/15 cursor-pointer hover:bg-[#FAF7F2] transition-colors ${
                                  !(member.events?.repasNoces ?? true) ? 'bg-slate-50 border-slate-200 opacity-60' : ''
                                }`}>
                                  <input
                                    type="checkbox"
                                    checked={member.events?.repasNoces ?? true}
                                    onChange={() => toggleEvent(member.id, 'repasNoces')}
                                    className="accent-[#C4A475] rounded"
                                  />
                                  <span className={`text-[11px] font-medium transition-all ${
                                    !(member.events?.repasNoces ?? true) ? 'line-through text-slate-400' : 'text-[#13263B]'
                                  }`}>
                                    Repas de Noces (19h00)
                                  </span>
                                </label>
                              )}

                              {/* Brunch */}
                              {member.invitedTo?.brunchLendemain !== false && (
                                <label className={`flex items-center gap-2 p-2 bg-white rounded-xl border border-[#3B6FA0]/15 cursor-pointer hover:bg-[#FAF7F2] transition-colors ${
                                  !(member.events?.brunchLendemain ?? true) ? 'bg-slate-50 border-slate-200 opacity-60' : ''
                                }`}>
                                  <input
                                    type="checkbox"
                                    checked={member.events?.brunchLendemain ?? true}
                                    onChange={() => toggleEvent(member.id, 'brunchLendemain')}
                                    className="accent-[#C4A475] rounded"
                                  />
                                  <span className={`text-[11px] font-medium transition-all ${
                                    !(member.events?.brunchLendemain ?? true) ? 'line-through text-slate-400' : 'text-[#13263B]'
                                  }`}>
                                    Brunch du Lendemain
                                  </span>
                                </label>
                              )}
                            </div>

                            {/* Dietary notes / Allergies */}
                            <div className="pt-2">
                              <input
                                type="text"
                                value={member.dietaryNotes || ''}
                                onChange={(e) => updateDietary(member.id, e.target.value)}
                                placeholder="Régime particulier / allergies (ex. Végétarien, Sans gluten, Sans arachides...)"
                                className="w-full px-3 py-2 bg-white border border-[#3B6FA0]/15 rounded-xl text-xs text-[#13263B] focus:outline-none focus:border-[#C4A475]"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Note si membre manquant */}
                  <div className="pt-2">
                    <div className="p-3.5 bg-[#FAF7F2] border border-[#3B6FA0]/15 rounded-xl text-xs text-[#5A5040] font-sans">
                      <p className="leading-relaxed">
                        Un membre de votre foyer manque à cette liste ? N’hésitez pas à nous le signaler directement via notre page{' '}
                        {onNavigateToContact ? (
                          <button
                            type="button"
                            onClick={onNavigateToContact}
                            className="font-semibold text-[#13263B] underline decoration-[#C4A475] underline-offset-2 hover:text-[#C4A475] cursor-pointer inline"
                          >
                            Nous contacter
                          </button>
                        ) : (
                          <span className="font-semibold text-[#13263B]">« Nous contacter »</span>
                        )}
                        {' '}afin que nous puissions l'ajouter.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: CONTACT EMAIL & MESSAGE */}
              {(selectedFamily || members.length > 0) && (
                <div className="space-y-4 pt-4 border-t border-[#3B6FA0]/15">
                  <div>
                    <label htmlFor="rsvp-email-input" className="block text-[11px] font-sans font-bold uppercase tracking-wider text-[#13263B] mb-2">
                      2. ADRESSE EMAIL DE CONTACT *
                    </label>
                    <input
                      id="rsvp-email-input"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="votre.email@exemple.fr"
                      className="w-full px-4 py-3 bg-white shadow-sm border border-[#3B6FA0]/20 rounded-2xl text-xs text-[#13263B] font-sans focus:outline-none focus:border-[#C4A475]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-sans font-bold uppercase tracking-wider text-[#13263B] mb-2">
                      3. UN PETIT MOT POUR LES MARIÉS OU LE LIVRE D'OR (OPTIONNEL)
                    </label>
                    <textarea
                      rows={3}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Laissez-nous un message doux pour graver ce souvenir..."
                      className="w-full px-4 py-3 bg-white shadow-sm border border-[#3B6FA0]/20 rounded-2xl text-xs text-[#13263B] font-sans focus:outline-none focus:border-[#C4A475] resize-none"
                    />
                  </div>

                  {/* Submit button */}
                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full py-4 px-4 bg-[#13263B] hover:bg-[#C4A475] hover:text-[#13263B] text-white font-sans font-semibold uppercase text-xs tracking-[0.15em] sm:tracking-[0.2em] transition-all cursor-pointer shadow-xs rounded-xl flex items-center justify-center gap-2 text-center disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Check className="w-4 h-4 text-[#C4A475] shrink-0" />
                      <span className="text-center">
                        {isSubmitting
                          ? 'ENREGISTREMENT...'
                          : (selectedFamily?.hasResponded
                            ? 'ENREGISTRER LA MISE À JOUR'
                            : 'ENVOYER LA CONFIRMATION')}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Default hint if family not yet searched */}
              {!selectedFamily && members.length === 0 && (
                <div className="p-6 bg-white/60 backdrop-blur-sm shadow-sm border border-dashed border-[#3B6FA0]/20 rounded-2xl text-center space-y-2">
                  <Heart className="w-5 h-5 text-[#C4A475] mx-auto" />
                  <p className="font-serif italic text-xs text-[#5A5040] leading-relaxed">
                    Saisissez au moins 3 lettres de votre prénom ou nom de famille ci-dessus pour retrouver votre foyer et confirmer votre présence en quelques clics. Si votre foyer n'apparaît pas ou s'il manque un membre de votre famille, n'hésitez pas à nous en informer directement via la rubrique{' '}
                    {onNavigateToContact ? (
                      <button
                        type="button"
                        onClick={onNavigateToContact}
                        className="font-semibold text-[#13263B] underline decoration-[#C4A475] underline-offset-2 hover:text-[#C4A475] cursor-pointer inline not-italic"
                      >
                        Nous contacter
                      </button>
                    ) : (
                      <span className="font-semibold text-[#13263B] not-italic">« Nous contacter »</span>
                    )}
                    .
                  </p>
                </div>
              )}

            </form>
          )}
        </AnimatePresence>
      </div>

      {/* POPUP CONFIRMATION SI PAS D'EMAIL */}
      <AnimatePresence>
        {showNoEmailModal && (
          <div className="fixed inset-0 bg-[#13263B]/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl border border-[#3B6FA0]/15 text-center space-y-5"
            >
              <div className="space-y-2">
                <h4 className="font-display text-xl sm:text-2xl text-[#13263B] font-semibold">
                  Adresse email non renseignée
                </h4>
                <p className="text-xs sm:text-sm font-sans text-[#5A5040] leading-relaxed">
                  Sans adresse email, vous ne recevrez pas de confirmation par courriel. Vous retrouverez toutefois le récapitulatif détaillé de vos choix sur l’écran suivant.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowNoEmailModal(false);
                    const input = document.getElementById('rsvp-email-input');
                    if (input) input.focus();
                  }}
                  className="w-full sm:w-auto px-5 py-3 rounded-xl border border-[#3B6FA0]/20 bg-white hover:bg-slate-50 text-[#13263B] font-semibold text-xs transition-all cursor-pointer whitespace-nowrap shrink-0"
                >
                  Ajouter un email
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNoEmailModal(false);
                    executeSubmit('');
                  }}
                  className="w-full sm:w-auto px-5 py-3 rounded-xl bg-[#13263B] hover:bg-[#C4A475] hover:text-[#13263B] text-white font-semibold text-xs uppercase tracking-wide transition-all cursor-pointer shadow-xs whitespace-nowrap shrink-0"
                >
                  Continuer sans email
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* POPUP INFORMATION INVITATION AU BRUNCH */}
      <AnimatePresence>
        {showBrunchModal && (
          <div
            className="fixed inset-0 bg-[#13263B]/60 backdrop-blur-xs flex items-center justify-center z-50 p-4"
            onClick={() => setShowBrunchModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-[#C4A475]/30 text-center space-y-5 relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Bouton fermeture */}
              <button
                type="button"
                onClick={() => setShowBrunchModal(false)}
                className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-[#13263B] rounded-full hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Icône sobre */}
              <div className="w-12 h-12 rounded-full bg-[#FAF7F2] border border-[#C4A475]/40 mx-auto flex items-center justify-center text-[#C4A475]">
                <Utensils className="w-5 h-5 text-[#C4A475]" />
              </div>

              <div className="space-y-2">
                <span className="text-[10px] tracking-[0.25em] font-sans uppercase font-bold text-[#C4A475] block">
                  Dimanche midi
                </span>
                <h4 className="font-display text-xl sm:text-2xl text-[#13263B] font-semibold">
                  Invitation au Brunch
                </h4>
                <div className="w-12 h-[1px] bg-[#C4A475]/50 mx-auto my-2" />
                <p className="text-xs sm:text-sm font-sans text-[#5A5040] leading-relaxed pt-1">
                  Rassurez-vous : vous êtes bien conviés au brunch du dimanche au Manoir d'Auffay, même si cela n'était pas précisé sur votre faire-part. Nous serons ravis de vous compter parmi nous pour prolonger ce moment !
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowBrunchModal(false)}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#13263B] hover:bg-[#C4A475] hover:text-[#13263B] text-white font-sans font-semibold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-sm"
                >
                  C'est noté
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
