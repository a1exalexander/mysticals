/**
 * Two languages: English at the site root (also x-default), Ukrainian under /uk/.
 * Pages live in src/pages/[...lang]/ and take their language from the URL.
 */
export const LANGS = ['en', 'uk'] as const
export type Lang = (typeof LANGS)[number]

/** getStaticPaths for every page: `lang` undefined renders the root, 'uk' renders /uk/... */
export const langPaths = () => [{ params: { lang: undefined } }, { params: { lang: 'uk' } }]

const PREFIX = /^\/uk(?=\/|$)/
export const langOf = (url: URL): Lang => (PREFIX.test(url.pathname) ? 'uk' : 'en')

/** A site path in a language: to('uk', '/install/') is '/uk/install/' */
export const to = (lang: Lang, path: string) => (lang === 'en' ? path : `/${lang}${path}`)

/** The page's path without the language prefix */
export const bare = (url: URL) => url.pathname.replace(PREFIX, '') || '/'

/** Ukrainian plural form: ukPlural(1, 'тема', 'теми', 'тем') is 'тема', 2 'теми', 11 'тем' */
export const ukPlural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many
