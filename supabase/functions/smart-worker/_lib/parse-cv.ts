// ============================================================
// _lib/parse-cv.ts
// Pass 1A: parse CV text into locked facts
// Extracts only what's literally in the CV. No invention.
// Result is cached in cv_versions.structured_cv.
// ============================================================

import { callLLM } from './llm.ts';
import { PARSE_CV_SYSTEM } from './prompts.ts';
import type { LLMConfig, StructuredCV } from './types.ts';

export const PARSE_VERSION = 2;

export async function parseCV(
  cvText: string,
  config: LLMConfig,
): Promise<StructuredCV> {
  const cvTextHash = await sha256Hex(cvText);

  const prompt = `Extract ONLY the facts literally present in this CV. Do not invent, infer, or guess anything.

CV TEXT:
${cvText.slice(0, 6000)}

Return ONLY this JSON. Use null or [] for anything not found in the CV:
{
  "locked": {
    "contact": {
      "name": null,
      "email": null,
      "phone": null,
      "location": null,
      "linkedin": null,
      "portfolio": null
    },
    "experience": [
      {
        "title": "exact job title from CV",
        "company": "exact company name from CV",
        "start_date": "exact date as written e.g. Sep 2024",
        "end_date": "exact date as written e.g. Mar 2026 or Present",
        "is_current": false,
        "raw_bullets": ["exact bullet point 1", "exact bullet point 2"],
        "technologies": ["technology or tool mentioned in this role"]
      }
    ],
    "education": [
      {
        "degree": "exact degree name",
        "institution": "exact institution name",
        "year": "exact graduation year or null"
      }
    ],
    "certifications": [
      {
        "name": "exact certification name",
        "issuer": "issuing body or null",
        "year": "year or null"
      }
    ],
    "total_years_experience": null,
    "seniority_level": "junior | mid-level | senior | lead",
    "has_sections": {
      "summary": false,
      "experience": false,
      "education": false,
      "skills": false,
      "projects": false,
      "certifications": false
    }
  },
  "locked_skills": {
    "technical": [],
    "tools": [],
    "soft": [],
    "languages": []
  }
}`;

  const result = await callLLM(
    prompt,
    PARSE_CV_SYSTEM,
    config,
    2500,
  ) as Partial<StructuredCV>;

  const defaults = buildDefaultStructuredCV(cvTextHash);

  return {
    ...defaults,
    ...result,
    locked: {
      ...defaults.locked,
      ...(result.locked ?? {}),
      contact: {
        ...defaults.locked.contact,
        ...(result.locked?.contact ?? {}),
      },
      has_sections: {
        ...defaults.locked.has_sections,
        ...(result.locked?.has_sections ?? {}),
      },
    },
    locked_skills: {
      ...defaults.locked_skills,
      ...(result.locked_skills ?? {}),
    },
    parsed_at: new Date().toISOString(),
    parse_version: PARSE_VERSION,
    cv_text_hash: cvTextHash,
  };
}

export async function isCacheValid(
  cached: unknown,
  cvText?: string,
): Promise<boolean> {
  if (
    !cached ||
    typeof cached !== 'object' ||
    Object.keys(cached).length === 0
  ) {
    return false;
  }

  const cv = cached as Partial<StructuredCV>;

  if (cv.parse_version !== PARSE_VERSION) {
    return false;
  }

  if (cvText) {
    const currentHash = await sha256Hex(cvText);
    return cv.cv_text_hash === currentHash;
  }

  return Boolean(cv.cv_text_hash);
}

function buildDefaultStructuredCV(cvTextHash: string): StructuredCV {
  return {
    locked: {
      contact: {
        name: null,
        email: null,
        phone: null,
        location: null,
        linkedin: null,
        portfolio: null,
      },
      experience: [],
      education: [],
      certifications: [],
      total_years_experience: null,
      seniority_level: 'mid-level',
      has_sections: {
        summary: false,
        experience: false,
        education: false,
        skills: false,
        projects: false,
        certifications: false,
      },
    },
    locked_skills: {
      technical: [],
      tools: [],
      soft: [],
      languages: [],
    },
    parsed_at: new Date().toISOString(),
    parse_version: PARSE_VERSION,
    cv_text_hash: cvTextHash,
  };
}

async function sha256Hex(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text.slice(0, 6000)),
  );

  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}