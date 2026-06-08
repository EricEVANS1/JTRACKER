export async function extractTextFromFile(fileUrl: string): Promise<string> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');

    if (!supabaseUrl) {
      throw new Error('SUPABASE_URL is not configured');
    }

    const response = await fetch(
      `${supabaseUrl}/functions/v1/extract-cv-text`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileUrl }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('[extractor] extraction failed:', data);
      return '';
    }

    // unwrap nested JSON text returned by extract-cv-text
    const rawText =
      typeof data.text === 'string'
        ? data.text.trim()
        : '';

    let text = rawText;

    try {
      const parsed = JSON.parse(rawText);

      if (typeof parsed.text === 'string') {
        text = parsed.text.trim();
      }
    } catch {
      // already plain text
    }

    if (!text || text.startsWith('%PDF')) {
      return '';
    }

    return text.slice(0, 20000);

  } catch (err) {
    console.error('[extractor] extractTextFromFile error:', err);
    return '';
  }
}