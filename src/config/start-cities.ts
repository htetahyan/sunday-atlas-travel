/**
 * Cities a tour can start in, with the name used in each locale. A tour's start city is the first
 * of these named in the English title of its day 1. Add a city here when a tour starts somewhere new.
 */
export type StartCity = { en: string; de: string; fr: string; ja: string; es: string; zh: string };

export const START_CITIES: readonly StartCity[] = [
  { en: "Almaty", de: "Almaty", fr: "Almaty", ja: "アルマトイ", es: "Almaty", zh: "阿拉木图" },
  { en: "Bishkek", de: "Bischkek", fr: "Bichkek", ja: "ビシュケク", es: "Biskek", zh: "比什凯克" },
  { en: "Yerevan", de: "Jerewan", fr: "Erevan", ja: "エレバン", es: "Ereván", zh: "埃里温" },
  { en: "Baku", de: "Baku", fr: "Bakou", ja: "バクー", es: "Bakú", zh: "巴库" },
  { en: "Tashkent", de: "Taschkent", fr: "Tachkent", ja: "タシケント", es: "Taskent", zh: "塔什干" },
  { en: "Ashgabat", de: "Aschgabat", fr: "Achgabat", ja: "アシガバート", es: "Asjabad", zh: "阿什哈巴德" },
  { en: "Harbin", de: "Harbin", fr: "Harbin", ja: "ハルビン", es: "Harbin", zh: "哈尔滨" },
  { en: "Dushanbe", de: "Duschanbe", fr: "Douchanbé", ja: "ドゥシャンベ", es: "Dusambé", zh: "杜尚别" },
  { en: "Kraków", de: "Krakau", fr: "Cracovie", ja: "クラクフ", es: "Cracovia", zh: "克拉科夫" },
  { en: "Poznań", de: "Posen", fr: "Poznań", ja: "ポズナン", es: "Poznan", zh: "波兹南" },
];
