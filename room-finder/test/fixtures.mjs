// Test fixtures modelled on the real page structures of House4Ever and 99acres (checked Nov 2026).

const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

export function h4eListPage(items, total = items.length) {
  return `<!doctype html><html><head><title>Rooms</title>${ld({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        url: "https://house4ever.com/mohali/sector-67/rooms-for-rent/",
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: total,
          itemListElement: items.map((it, i) => ({
            "@type": "ListItem",
            position: i + 1,
            item: {
              "@type": "Offer",
              url: it.url,
              name: it.name,
              price: it.price,
              priceCurrency: "INR",
              itemOffered: { "@type": "Room", name: it.name, address: { "@type": "PostalAddress", streetAddress: it.address || "Sector 67, Mohali", addressLocality: "Mohali" } },
            },
          })),
        },
      },
      { "@type": "BreadcrumbList", itemListElement: [] },
    ],
  })}</head><body>${"x".repeat(25000)}</body></html>`;
}

export function h4eDetailPage({ url, name, price, lat, lng, description = "Single room. Fully furnished. Listed by the owner.", posted = "2026-11-20T04:48:45.508Z", modified = "2026-11-24T04:48:45.508Z" }) {
  return `<html><head>${ld({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "RealEstateListing", url, name, description, datePosted: posted, dateModified: modified, offers: { "@type": "Offer", price, priceCurrency: "INR", availability: "https://schema.org/InStock" } },
      { "@type": "Room", name, numberOfRooms: 1, amenityFeature: [{ "@type": "LocationFeatureSpecification", name: "Fully Furnished", value: true }], geo: { "@type": "GeoCoordinates", latitude: lat, longitude: lng }, address: { streetAddress: "Sector 67, Sahibzada Ajit Singh Nagar" } },
      { "@type": "BreadcrumbList" },
    ],
  })}</head><body>${"y".repeat(25000)}</body></html>`;
}

export function acresPage(props) {
  const data = { srp: { pageData: { properties: props, vsp: [] } } };
  return `<html><body>${"z".repeat(25000)}<script>window.__initialData__=${JSON.stringify(data)};window.__masked__=false</script></body></html>`;
}

export const acresProp = (o = {}) => ({
  PROP_ID: "U93538524",
  PD_URL: "/paying-guest-pg-for-rent-in-unity-homeland-cp-67-sector-67-mohali-spid-U93538524",
  PROP_HEADING: "Girls & Boys PG/Paying Guest in Sector 67 Mohali",
  SUB_HEADING: "For Boys/Girls",
  DESCRIPTION: "Newly built PG | AC rooms | 3-Time food | near CP67 mall",
  LOCALITY: "Sector 67 Mohali",
  MIN_PRICE: "8000",
  MAX_PRICE: "8000",
  FORMATTED_PRICE: "8,000/Bed",
  DEPOSIT: "4000",
  DEPOSIT_TYPE: "FIXED",
  BROKERAGE: "0",
  SHARING_COUNT: "2",
  POSTING_DATE: 1786800690000,
  UPDATE_DATE: 1795691920000,
  MAP_DETAILS: { LATITUDE: "30.6721392", LONGITUDE: "76.7119189", MAPPED: "Y" },
  ...o,
});

export const H4E_ROBOTS = `User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /

User-agent: GPTBot
Disallow: /

User-agent: *
Allow: /
Allow: /*?page=
Disallow: /api/
Disallow: /login/
Disallow: /search/
Disallow: /*?
`;
