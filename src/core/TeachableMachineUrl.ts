export function normalizeTeachableMachineUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:' || url.hostname !== 'teachablemachine.withgoogle.com' ||
    url.port || url.username || url.password || url.search || url.hash ||
    !/^\/models\/[A-Za-z0-9_-]+\/?$/.test(url.pathname))
    throw new Error('Paste an HTTPS Teachable Machine model link.');
  return `${url.origin}${url.pathname.replace(/\/$/, '')}/`;
}
