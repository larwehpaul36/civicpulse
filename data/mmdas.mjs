// The 261 Metropolitan (M), Municipal (U) and District (D) Assemblies of Ghana, by region.
// Source: the per-region lists on Wikipedia's "Districts of Ghana" page, cross-checked against the official total (261,
// of which 6 metropolitan) and each region's own count. Verify against the Local Government Service list before launch;
// a few municipal/district labels differ between sources, but the total and the names are what routing depends on.
const RAW = {
  'Ahafo': 'Asunafo North U; Asunafo South D; Asutifi North D; Asutifi South D; Tano North U; Tano South U',
  'Ashanti': 'Adansi Asokwa D; Adansi North D; Adansi South D; Afigya-Kwabre North D; Afigya-Kwabre South D; Ahafo-Ano North U; Ahafo-Ano South East D; Ahafo-Ano South West D; Akrofuom D; Amansie Central D; Amansie West D; Amansie South D; Asante-Akim Central U; Asante-Akim North D; Asante-Akim South U; Asokore-Mampong U; Asokwa U; Atwima-Kwanwoma D; Atwima-Mponua D; Atwima-Nwabiagya U; Atwima-Nwabiagya North D; Bekwai U; Bosome Freho D; Bosomtwe D; Ejisu U; Ejura/Sekyedumase U; Juaben U; Kumasi M; Kwabre East U; Kwadaso U; Mampong U; Obuasi East U; Obuasi U; Offinso U; Offinso North D; Oforikrom U; Old Tafo U; Sekyere Afram Plains D; Sekyere Central D; Sekyere East D; Sekyere Kumawu D; Sekyere South D; Suame U',
  'Bono': 'Banda D; Berekum East U; Berekum West D; Dormaa Central U; Dormaa East D; Dormaa West D; Jaman North D; Jaman South U; Sunyani U; Sunyani West D; Tain D; Wenchi U',
  'Bono East': 'Atebubu-Amantin U; Kintampo North U; Kintampo South D; Nkoranza North D; Nkoranza South U; Pru East D; Pru West D; Sene East D; Sene West D; Techiman U; Techiman North D',
  'Central': 'Abura/Asebu/Kwamankese D; Agona East D; Agona West U; Ajumako/Enyan/Essiam D; Asikuma Odoben Brakwa D; Assin Central U; Assin North D; Assin South D; Awutu Senya East U; Awutu Senya West D; Cape Coast M; Effutu U; Ekumfi D; Gomoa East D; Gomoa Central D; Gomoa West D; Komenda/Edina/Eguafo/Abirem U; Mfantsiman U; Twifo Atti Morkwa D; Twifo/Hemang/Lower Denkyira D; Upper Denkyira East U; Upper Denkyira West D',
  'Eastern': 'Abuakwa North U; Abuakwa South U; Achiase D; Akuapim North U; Akuapim South D; Akyemansa D; Asene Manso Akroso D; Asuogyaman D; Atiwa East D; Atiwa West D; Ayensuano D; Birim Central U; Birim North D; Birim South D; Denkyembour D; Fanteakwa North D; Fanteakwa South D; Kwaebibirem U; Kwahu Afram Plains North D; Kwahu Afram Plains South D; Kwahu East D; Kwahu South D; Kwahu West U; Lower Manya Krobo U; New Juaben North U; New Juaben South U; Nsawam Adoagyire U; Okere D; Suhum U; Upper Manya Krobo D; Upper West Akim D; West Akim U; Yilo-Krobo U',
  'Greater Accra': 'Ablekuma Central U; Ablekuma North U; Ablekuma West U; Accra M; Ada East D; Ada West D; Adenta U; Ashaiman U; Ayawaso Central U; Ayawaso East U; Ayawaso North U; Ayawaso West U; Ga Central U; Ga East U; Ga North U; Ga South U; Ga West U; Korle-Klottey U; Kpone-Katamanso U; Krowor U; La-Dade-Kotopon U; La-Nkwantanang-Madina U; Ledzokuku U; Ningo-Prampram D; Okaikwei North U; Shai-Osudoku D; Tema M; Tema West U; Weija Gbawe U',
  'North East': 'Bunkpurugu Nyankpanduri D; Chereponi D; East Mamprusi U; Mamprugu Moagduri D; West Mamprusi U; Yunyoo-Nasuan D',
  'Northern': 'Gushegu U; Karaga D; Kpandai D; Kumbungu D; Mion D; Nanton D; Nanumba North U; Nanumba South D; Saboba D; Sagnarigu U; Savelugu U; Tamale M; Tatale Sanguli D; Tolon D; Yendi U; Zabzugu D',
  'Oti': 'Biakoye D; Guan D; Jasikan U; Kadjebi D; Krachi East U; Krachi Nchumuru D; Krachi West U; Nkwanta North D; Nkwanta South U',
  'Savannah': 'Bole D; Central Gonja D; East Gonja U; North Gonja D; North East Gonja D; Sawla-Tuna-Kalba D; West Gonja U',
  'Upper East': 'Bawku U; Bawku West D; Binduri D; Bolgatanga East D; Bolgatanga U; Bongo D; Builsa North U; Builsa South D; Garu D; Kassena-Nankana U; Kassena-Nankana West D; Nabdam D; Pusiga D; Talensi D; Tempane D',
  'Upper West': 'Daffiama Bussie Issa D; Jirapa U; Lambussie Karni D; Lawra U; Nadowli-Kaleo D; Nandom U; Sissala East U; Sissala West D; Wa East D; Wa U; Wa West D',
  'Volta': 'Adaklu D; Afadzato South D; Agotime Ziope D; Akatsi North D; Akatsi South D; Anloga D; Central Tongu D; Ho U; Ho West D; Hohoe U; Keta U; Ketu North U; Ketu South U; Kpando U; North Dayi D; North Tongu D; South Dayi D; South Tongu D',
  'Western': 'Ahanta West U; Amenfi Central D; Amenfi West U; Effia Kwesimintsim U; Ellembelle D; Jomoro U; Mpohor D; Nzema East U; Prestea-Huni Valley U; Sekondi Takoradi M; Shama D; Tarkwa-Nsuaem U; Wassa Amenfi East U; Wassa East D',
  'Western North': 'Aowin U; Bia East D; Bia West D; Bibiani Anhwiaso Bekwai U; Bodi D; Juaboso D; Sefwi Akontombra D; Sefwi-Wiawso U; Suaman D',
};

const WORD = { M: 'Metropolitan', U: 'Municipal', D: 'District' };

// [{ region: 'Ashanti', category: 'M', name: 'Kumasi Metropolitan' }, ...]
export const MMDAS = Object.entries(RAW).flatMap(([region, list]) =>
  list.split(';').map((s) => s.trim()).map((s) => {
    const i = s.lastIndexOf(' ');
    const category = s.slice(i + 1);
    return { region, category, name: `${s.slice(0, i)} ${WORD[category]}` };
  }));

// Each region's own count on the source page (used by the tests as a cross-check).
export const SOURCE_COUNTS = {
  'Ahafo': 6, 'Ashanti': 43, 'Bono': 12, 'Bono East': 11, 'Central': 22, 'Eastern': 33, 'Greater Accra': 29, 'North East': 6,
  'Northern': 16, 'Oti': 9, 'Savannah': 7, 'Upper East': 15, 'Upper West': 11, 'Volta': 18, 'Western': 14, 'Western North': 9,
};
export const OFFICIAL_TOTAL = 261;
export const OFFICIAL_METROPOLITAN = 6;
