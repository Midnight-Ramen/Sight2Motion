export async function openSetup(page, title) {
  const header = page.getByRole('button', { name: title, exact: true });
  if (await header.getAttribute('aria-expanded') !== 'true') await header.click();
}
