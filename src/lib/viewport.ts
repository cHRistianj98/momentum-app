/**
 * Układ telefonu w JS — te same warunki co `@media` w arkuszach (styles.css, styles-v06.css):
 * wąski ekran albo telefon obrócony poziomo (np. iPhone 16: 852 × 393), który dostaje układ telefonu, a nie komputera.
 */
export const PHONE_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)';

/** Czy obowiązuje układ telefonu dla danego progu szerokości (domyślnie 620 px — jak w arkuszach). */
export function isPhoneLayout(maxWidth = 620): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(`(max-width: ${maxWidth}px), ${PHONE_LANDSCAPE_QUERY}`).matches;
}
