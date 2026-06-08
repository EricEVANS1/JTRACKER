// ============================================================
// assembler.ts — builds final CV from locked facts + suggestions
//
// This is pure deterministic code. Not AI.
// Locked facts (employer, title, dates) CANNOT be changed here.
// AI suggestions fill only the editable slots.
//
// Keyword suggestions with accepted=false are NEVER injected.
// User must explicitly accept them in the Resume Builder.
// ============================================================

import { makeRoleKey, deduplicateKeywords } from './helpers.ts';
import type { StructuredCV, CVSuggestions } from './types.ts';

export function assembleCv(cv: StructuredCV, suggestions: CVSuggestions): string {
  const l = cv.locked;
  const lines: string[] = [];

  // ---- CONTACT (locked — assembler writes from structured facts) ----
  if (l.contact.name) {
    lines.push(l.contact.name.toUpperCase());
  }

  const contactParts = [
    l.contact.email,
    l.contact.phone,
    l.contact.location,
    l.contact.linkedin,
    l.contact.portfolio,
  ].filter(Boolean);

  if (contactParts.length > 0) {
    lines.push(contactParts.join(' | '));
  }

  lines.push('');

  // ---- PROFESSIONAL SUMMARY (AI suggestion — editable) ----
  if (suggestions.summary?.trim()) {
    lines.push('PROFESSIONAL SUMMARY');
    lines.push(suggestions.summary.trim());
    lines.push('');
  }

  // ---- SKILLS ----
  // Base: locked skills (what the candidate actually has)
  // Reordering: from suggestions.skills_emphasis if provided
  // Keywords: ONLY those with accepted=true (user explicitly accepted)
  const acceptedKeywords = (suggestions.keyword_suggestions ?? [])
    .filter(k => k.accepted === true && k.section === 'skills')
    .map(k => k.keyword);

  const baseSkills = suggestions.skills_emphasis?.length > 0
    ? suggestions.skills_emphasis
    : [...cv.locked_skills.technical, ...cv.locked_skills.tools];

  const allSkills = deduplicateKeywords([...baseSkills, ...acceptedKeywords]);

  if (allSkills.length > 0 || cv.locked_skills.soft.length > 0 || cv.locked_skills.languages.length > 0) {
    lines.push('SKILLS');

    if (allSkills.length > 0) {
      lines.push(allSkills.join(' | '));
    }

    if (cv.locked_skills.soft.length > 0) {
      lines.push(`Soft skills: ${cv.locked_skills.soft.join(', ')}`);
    }

    if (cv.locked_skills.languages.length > 0) {
      lines.push(`Languages: ${cv.locked_skills.languages.join(', ')}`);
    }

    lines.push('');
  }

  // ---- EXPERIENCE ----
  // Employer name, title, and dates are LOCKED — written from structured facts
  // Bullets: AI-improved if available, else original verbatim
  if (l.experience.length > 0) {
    lines.push('EXPERIENCE');

    for (const exp of l.experience) {
      // LOCKED — these three lines cannot be changed by AI
      lines.push(`${exp.title} | ${exp.company}`);
      lines.push(`${exp.start_date} – ${exp.end_date}`);

      // Bullets: use AI suggestions if they exist and are non-empty
      const roleKey = makeRoleKey(exp.company, exp.title);
      const aiBullets = suggestions.experience_bullets?.[roleKey];
      const bullets = (aiBullets && aiBullets.length > 0)
        ? aiBullets
        : exp.raw_bullets;

      if (bullets.length > 0) {
        bullets.forEach(b => {
          // Normalise bullet prefix
          lines.push(`• ${b.replace(/^[•\-*]\s*/, '').trim()}`);
        });
      }

      lines.push('');
    }
  }

  // ---- EDUCATION (locked) ----
  if (l.education.length > 0) {
    lines.push('EDUCATION');

    for (const edu of l.education) {
      const parts = [edu.degree, edu.institution, edu.year].filter(Boolean);
      lines.push(parts.join(' | '));
    }

    lines.push('');
  }

  // ---- CERTIFICATIONS (locked) ----
  if (l.certifications.length > 0) {
    lines.push('CERTIFICATIONS');

    for (const cert of l.certifications) {
      const parts = [cert.name, cert.issuer, cert.year].filter(Boolean);
      lines.push(parts.join(' | '));
    }

    lines.push('');
  }

  return lines.join('\n').trim();
}

// Fallback: assemble from facts only when suggestions are unavailable
export function assembleCvFromFactsOnly(cv: StructuredCV): string {
  return assembleCv(cv, {
    summary: '',
    experience_bullets: {},
    skills_emphasis: [],
    keyword_suggestions: [],
    generated_for_job_title: null,
    generated_for_jd_hash: null,
    generated_at: new Date().toISOString(),
  });
}