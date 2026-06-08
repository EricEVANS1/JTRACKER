const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

console.log('EXTRACT CV TEXT VERSION 2 RUNNING');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { fileUrl } = await req.json();

    if (!fileUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing fileUrl' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

const apiKey = Deno.env.get('PARSER_API_KEY');
const apiUrl = Deno.env.get('PARSER_API_URL');

if (!apiKey) {
  throw new Error('Missing PARSER_API_KEY');
}

if (!apiUrl) {
  throw new Error('Missing PARSER_API_URL');
}

    const fileRes = await fetch(fileUrl);

    if (!fileRes.ok) {
      throw new Error(`Failed to download file: ${fileRes.status}`);
    }

    const fileBlob = await fileRes.blob();

    const form = new FormData();

    form.append('file', fileBlob, 'cv.pdf');

    form.append('result_type', 'text');

    const uploadRes = await fetch(
      `${apiUrl}/api/parsing/upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      },
    );

    const uploadData = await uploadRes.json();

    if (!uploadRes.ok) {
      throw new Error(
        uploadData?.detail || 'LlamaParse upload failed',
      );
    }

    const jobId = uploadData.id;

    let extractedText = '';

    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const resultRes = await fetch(
        `${apiUrl}/api/parsing/job/${jobId}/result/text`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
      );

      if (resultRes.ok) {
        extractedText = await resultRes.text();

        if (extractedText?.trim()) {
          break;
        }
      }
    }

    return new Response(
      JSON.stringify({
        text: extractedText,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  }
});