export async function humanType(locator, text: string, min = 25, max = 60) {
  for (const ch of text.split('')) {
    await locator.type(ch, { delay: Math.floor(Math.random() * (max - min + 1)) + min });
  }
}

export async function humanPause(minMs = 400, maxMs = 1200) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await new Promise(r => setTimeout(r, delay));
}
