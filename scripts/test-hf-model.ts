import { OpenAI } from 'openai'

const MODEL = process.env.TEST_MODEL ?? 'Qwen/Qwen3.6-35B-A3B:featherless-ai'

async function main() {
  if (!process.env.HF_TOKEN) {
    throw new Error('HF_TOKEN is not set in env')
  }

  const client = new OpenAI({
    baseURL: 'https://router.huggingface.co/v1',
    apiKey: process.env.HF_TOKEN,
  })

  console.log(`[test] model=${MODEL}`)
  const t0 = Date.now()

  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image in one sentence.' },
          {
            type: 'image_url',
            image_url: {
              url: 'https://cdn.britannica.com/61/93061-050-99147DCE/Statue-of-Liberty-Island-New-York-Bay.jpg',
            },
          },
        ],
      },
    ],
  })

  const ms = Date.now() - t0
  console.log(`[test] ${ms}ms`)
  console.log(JSON.stringify(res.choices[0]?.message, null, 2))
}

main().catch((err) => {
  console.error('[test] failed:', err?.message ?? err)
  if (err?.status) console.error('[test] status:', err.status)
  if (err?.error) console.error('[test] error body:', JSON.stringify(err.error, null, 2))
  process.exit(1)
})
