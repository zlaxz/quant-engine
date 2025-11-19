/**
 * Shared embedding generation utilities for memory system
 * Uses OpenAI text-embedding-3-small model (1536 dimensions)
 */

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536;

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  
  if (!apiKey) {
    console.error('OPENAI_API_KEY not configured');
    return null;
  }

  if (!text || text.trim().length === 0) {
    console.error('Cannot generate embedding for empty text');
    return null;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.trim(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenAI embeddings API error (${response.status}):`, errorText);
      return null;
    }

    const data = await response.json();
    
    if (!data.data || !data.data[0] || !data.data[0].embedding) {
      console.error('Unexpected embeddings API response format:', data);
      return null;
    }

    const embedding = data.data[0].embedding;
    
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSION) {
      console.error(`Invalid embedding dimension: expected ${EMBEDDING_DIMENSION}, got ${embedding.length}`);
      return null;
    }

    return embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return null;
  }
}

export { EMBEDDING_DIMENSION };
