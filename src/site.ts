/** The public address (also in index.html, robots.txt and sitemap.xml). */
export const SITE_URL = "https://tangram.apexlearninghub.org";

/** A link that opens a specific puzzle directly, e.g. https://…/?p=p23 */
export const puzzleLink = (id: string) => `${SITE_URL}/?p=${encodeURIComponent(id)}`;

/** The puzzle id in the current address (`?p=…`), if any. */
export const puzzleIdFromUrl = () => new URLSearchParams(location.search).get("p");
