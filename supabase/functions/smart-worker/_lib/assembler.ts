// ============================================================
// _lib/assembler.ts
// Safe CV assembly helpers
// ============================================================

export function assembleCvFromFactsOnly(structuredCV: any): string {
  const sections: string[] = [];

  const personal = structuredCV?.personal_info ?? {};

  const name =
    personal?.name ||
    structuredCV?.name ||
    '';

  const email =
    personal?.email ||
    structuredCV?.email ||
    '';

  const phone =
    personal?.phone ||
    structuredCV?.phone ||
    '';

  const location =
    personal?.location ||
    structuredCV?.location ||
    '';

  const header = [name, email, phone, location]
    .filter(Boolean)
    .join(' | ');

  if (header) {
    sections.push(header);
  }

  if (structuredCV?.summary) {
    sections.push(`SUMMARY\n${structuredCV.summary}`);
  }

  const skills = arrayToStrings(structuredCV?.skills);

  if (skills.length) {
    sections.push(`SKILLS\n${skills.join(', ')}`);
  }

  const experience = arrayToStrings(structuredCV?.experience);

  if (experience.length) {
    sections.push(`EXPERIENCE\n${experience.join('\n\n')}`);
  }

  const projects = arrayToStrings(structuredCV?.projects);

  if (projects.length) {
    sections.push(`PROJECTS\n${projects.join('\n\n')}`);
  }

  const education = arrayToStrings(structuredCV?.education);

  if (education.length) {
    sections.push(`EDUCATION\n${education.join('\n\n')}`);
  }

  const certifications = arrayToStrings(structuredCV?.certifications);

  if (certifications.length) {
    sections.push(`CERTIFICATIONS\n${certifications.join(', ')}`);
  }

  const languages = arrayToStrings(structuredCV?.languages);

  if (languages.length) {
    sections.push(`LANGUAGES\n${languages.join(', ')}`);
  }

  if (!sections.length) {
    return String(
      structuredCV?.raw_text ||
        structuredCV?.text ||
        'No CV content available.',
    );
  }

  return sections.join('\n\n');
}

export function assembleCv(
  structuredCV: any,
  suggestions: any,
): string {
  const baseCv = assembleCvFromFactsOnly(structuredCV);

  const improvedSummary =
    suggestions?.summary ||
    suggestions?.professional_summary ||
    '';

  const improvedBullets = Array.isArray(suggestions?.experience_bullets)
    ? suggestions.experience_bullets
    : Array.isArray(suggestions?.bullets)
      ? suggestions.bullets
      : [];

  const suggestedSkills = Array.isArray(suggestions?.skills)
    ? suggestions.skills
    : Array.isArray(suggestions?.keywords_to_add)
      ? suggestions.keywords_to_add
      : [];

  const sections: string[] = [];

  if (improvedSummary) {
    sections.push(`TAILORED SUMMARY\n${improvedSummary}`);
  }

  if (improvedBullets.length) {
    sections.push(`SUGGESTED EXPERIENCE BULLETS\n${improvedBullets.join('\n')}`);
  }

  if (suggestedSkills.length) {
    sections.push(`SUGGESTED SKILLS\n${suggestedSkills.join(', ')}`);
  }

  if (!sections.length) {
    return baseCv;
  }

  return `${baseCv}\n\n${sections.join('\n\n')}`;
}

function arrayToStrings(value: any): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item) return '';

      if (typeof item === 'string') {
        return item.trim();
      }

      if (typeof item === 'object') {
        const title =
          item.title ||
          item.role ||
          item.position ||
          item.degree ||
          item.name ||
          '';

        const company =
          item.company ||
          item.organisation ||
          item.organization ||
          item.school ||
          item.institution ||
          '';

        const period =
          item.period ||
          item.dates ||
          item.date ||
          '';

        const description =
          item.description ||
          item.summary ||
          '';

        const bullets = Array.isArray(item.bullets)
          ? item.bullets.join('\n')
          : Array.isArray(item.responsibilities)
            ? item.responsibilities.join('\n')
            : '';

        return [title, company, period, description, bullets]
          .filter(Boolean)
          .join(' — ')
          .trim();
      }

      return String(item).trim();
    })
    .filter(Boolean);
}