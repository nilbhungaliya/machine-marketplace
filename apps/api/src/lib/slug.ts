/**
 * URL slug from an English name: accents dropped, lowercase, `&` → `and`, apostrophes dropped, every other run of
 * non-alphanumerics → one `-`, no leading/trailing `-`. `"Men's Wear"` → `mens-wear`, `"Lässer"` → `lasser`.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
