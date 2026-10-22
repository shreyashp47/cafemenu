/**
 * Starter menus (issue #16): a whole menu in one tap, for an owner who would
 * rather edit a menu than type one. The cafe app offers them on an empty
 * menu, and the console's signup form offers the same ones.
 *
 * Prices: priced for a few currencies, blank for the rest. A starter menu
 * with no prices cannot take an order, and typing fifteen prices is most of
 * the work it was meant to save; a price the owner nudges is one edit. So each
 * item has a price in US cents, and each currency in STARTER_PRICE_LEVELS says
 * what a cafe dollar is there: a rough late-2026 local price for what costs
 * $1 in an American cafe, and a step to round to, so prices read like a menu
 * ("₹180", "€3.60", "¥540") and not like an exchange rate ("₹374.62").
 *
 * One level per currency rather than a price per item per currency: four
 * menus in eight currencies would be some five hundred numbers that nobody
 * could check, for a guess the owner changes anyway. A currency not in the
 * table gets empty prices (null) for the owner to fill in; guessing from
 * exchange rates gets cafe prices wrong by a factor of two or more.
 *
 * The items are originals written for CafeMenu.
 *
 * Like the rest of this package: no dependencies, erasable syntax only.
 */

import { menuToCsv, type ImportSettings } from "./menu-import.ts";
import { moneyDigits, type MoneySettings } from "./money.ts";

export const STARTER_MENU_IDS = [
  "coffee-shop",
  "tea-house",
  "bakery",
  "juice-bar",
] as const;
export type StarterMenuId = (typeof STARTER_MENU_IDS)[number];

export interface StarterItem {
  name: string;
  category: string;
  description: string;
  /** What it would cost in an American cafe, in US cents. */
  usdCents: number;
}

export interface StarterMenu {
  id: StarterMenuId;
  name: string;
  /** One line, for the button that picks it. */
  blurb: string;
  items: readonly StarterItem[];
}

/**
 * What a cafe dollar is in each currency, and what its prices round to, both
 * in whole units of the currency.
 */
export const STARTER_PRICE_LEVELS: Record<
  string,
  { perDollar: number; step: number }
> = {
  USD: { perDollar: 1, step: 0.25 },
  CAD: { perDollar: 1.15, step: 0.25 },
  AUD: { perDollar: 1.2, step: 0.1 },
  SGD: { perDollar: 1.3, step: 0.1 },
  EUR: { perDollar: 0.8, step: 0.1 },
  GBP: { perDollar: 0.75, step: 0.1 },
  INR: { perDollar: 40, step: 10 },
  JPY: { perDollar: 120, step: 10 },
};

const item = (
  name: string,
  category: string,
  usdCents: number,
  description: string,
): StarterItem => ({ name, category, description, usdCents });

export const STARTER_MENUS: readonly StarterMenu[] = [
  {
    id: "coffee-shop",
    name: "Coffee shop",
    blurb: "Espresso drinks, a few teas, toast and bakes.",
    items: [
      item("Espresso", "Coffee", 300, "A short, strong double shot."),
      item("Americano", "Coffee", 350, "Espresso stretched with hot water."),
      item("Cappuccino", "Coffee", 450, "Equal parts espresso, milk and foam."),
      item(
        "Flat White",
        "Coffee",
        475,
        "A double shot under thin, velvety milk.",
      ),
      item(
        "Café Latte",
        "Coffee",
        450,
        "Mild and milky, with a little foam on top.",
      ),
      item(
        "Mocha",
        "Coffee",
        525,
        "Espresso, dark chocolate and steamed milk.",
      ),
      item("Cold Brew", "Coffee", 475, "Steeped overnight, served over ice."),
      item(
        "Iced Vanilla Latte",
        "Coffee",
        525,
        "Espresso, cold milk and vanilla, shaken with ice.",
      ),
      item(
        "Hot Chocolate",
        "Not coffee",
        425,
        "Melted chocolate whisked into hot milk.",
      ),
      item(
        "Chai Latte",
        "Not coffee",
        475,
        "Spiced black tea with steamed milk.",
      ),
      item(
        "Butter Croissant",
        "Food",
        375,
        "Flaky, golden, baked this morning.",
      ),
      item("Banana Bread", "Food", 350, "A thick slice, toasted, with butter."),
      item(
        "Avocado Toast",
        "Food",
        900,
        "Sourdough, smashed avocado, lime, chilli flakes.",
      ),
      item(
        "Cheese Toastie",
        "Food",
        800,
        "Melted cheddar and onion, pressed till crisp.",
      ),
      item("Chocolate Chip Cookie", "Sweets", 275, "Crisp edges, soft middle."),
      item(
        "Lemon Drizzle Slice",
        "Sweets",
        375,
        "Zesty sponge with a sugar crust.",
      ),
    ],
  },
  {
    id: "tea-house",
    name: "Tea house",
    blurb: "Black, green and herbal teas, iced teas and small plates.",
    items: [
      item(
        "English Breakfast",
        "Hot tea",
        350,
        "A brisk black blend; milk on the side.",
      ),
      item("Earl Grey", "Hot tea", 375, "Black tea scented with bergamot."),
      item(
        "Darjeeling",
        "Hot tea",
        450,
        "Light, floral, from the Himalayan foothills.",
      ),
      item(
        "Jasmine Green",
        "Hot tea",
        375,
        "Green tea layered with jasmine blossom.",
      ),
      item("Sencha", "Hot tea", 400, "Grassy Japanese green tea."),
      item("Oolong", "Hot tea", 500, "Half-oxidised, toasty and smooth."),
      item("Peppermint", "Hot tea", 325, "Whole mint leaves, no caffeine."),
      item(
        "Chamomile & Honey",
        "Hot tea",
        350,
        "Calming flowers with a spoon of honey.",
      ),
      item(
        "Masala Chai",
        "Hot tea",
        375,
        "Black tea simmered with milk, ginger and cardamom.",
      ),
      item("Matcha Latte", "Hot tea", 525, "Whisked matcha with steamed milk."),
      item(
        "Peach Iced Tea",
        "Iced tea",
        425,
        "Black tea, ripe peach, lots of ice.",
      ),
      item(
        "Hibiscus Cooler",
        "Iced tea",
        425,
        "Tart hibiscus with lime and mint.",
      ),
      item(
        "Brown Sugar Milk Tea",
        "Iced tea",
        550,
        "Milk tea with brown sugar syrup.",
      ),
      item(
        "Cucumber Sandwiches",
        "Small plates",
        650,
        "Soft bread, cream cheese, thin cucumber.",
      ),
      item(
        "Scones, Jam & Cream",
        "Small plates",
        600,
        "Two warm scones with the works.",
      ),
      item(
        "Shortbread",
        "Small plates",
        275,
        "Buttery, crumbly, made in-house.",
      ),
    ],
  },
  {
    id: "bakery",
    name: "Bakery",
    blurb: "Bread, pastries, cake by the slice and coffee to go with them.",
    items: [
      item(
        "Sourdough Loaf",
        "Bread",
        800,
        "Long-fermented, with a crackly crust.",
      ),
      item("Seeded Rye", "Bread", 750, "Dense and nutty, packed with seeds."),
      item("Baguette", "Bread", 400, "Crisp outside, open and chewy inside."),
      item("Focaccia Slice", "Bread", 450, "Olive oil, sea salt and rosemary."),
      item("Butter Croissant", "Pastries", 375, "Flaky layers, all butter."),
      item(
        "Pain au Chocolat",
        "Pastries",
        425,
        "Croissant dough around dark chocolate.",
      ),
      item(
        "Almond Croissant",
        "Pastries",
        475,
        "Filled with almond cream, topped with flakes.",
      ),
      item(
        "Cinnamon Roll",
        "Pastries",
        450,
        "Soft swirls, cinnamon sugar, a little glaze.",
      ),
      item(
        "Cardamom Knot",
        "Pastries",
        450,
        "Twisted dough with cardamom and pearl sugar.",
      ),
      item(
        "Fruit Danish",
        "Pastries",
        425,
        "Custard and seasonal fruit on puff pastry.",
      ),
      item(
        "Blueberry Muffin",
        "Cakes",
        375,
        "Bursting with berries, crumble on top.",
      ),
      item("Carrot Cake", "Cakes", 550, "Spiced, with cream cheese frosting."),
      item(
        "Chocolate Fudge Cake",
        "Cakes",
        550,
        "Three layers, rich and dark.",
      ),
      item("Lemon Tart", "Cakes", 500, "Sharp lemon curd in a crisp shell."),
      item(
        "Filter Coffee",
        "Drinks",
        300,
        "Freshly brewed; refills on request.",
      ),
      item("Cappuccino", "Drinks", 450, "Espresso, steamed milk and foam."),
    ],
  },
  {
    id: "juice-bar",
    name: "Juice bar",
    blurb: "Fresh juices, smoothies, shots and bowls.",
    items: [
      item("Fresh Orange", "Juices", 550, "Squeezed to order, nothing added."),
      item(
        "Watermelon Mint",
        "Juices",
        550,
        "Cold watermelon with a handful of mint.",
      ),
      item(
        "Green Glow",
        "Juices",
        650,
        "Apple, cucumber, celery, spinach and lemon.",
      ),
      item("Carrot Ginger", "Juices", 600, "Sweet carrot with a ginger kick."),
      item("Beet Berry", "Juices", 650, "Beetroot, berries and apple."),
      item(
        "Pineapple Turmeric",
        "Juices",
        600,
        "Pineapple, turmeric and a squeeze of lime.",
      ),
      item(
        "Berry Blast",
        "Smoothies",
        700,
        "Mixed berries, banana and yoghurt.",
      ),
      item(
        "Peanut Butter Banana",
        "Smoothies",
        725,
        "Banana, peanut butter, oats and milk.",
      ),
      item(
        "Tropical Mango",
        "Smoothies",
        700,
        "Mango, pineapple and coconut water.",
      ),
      item(
        "Green Protein",
        "Smoothies",
        775,
        "Spinach, banana, almond milk and protein.",
      ),
      item("Ginger Shot", "Shots", 300, "Fiery ginger with lemon."),
      item(
        "Wheatgrass Shot",
        "Shots",
        325,
        "Pressed fresh, earthy and bright.",
      ),
      item(
        "Açaí Bowl",
        "Bowls",
        1050,
        "Açaí, banana and berries under granola.",
      ),
      item(
        "Overnight Oats",
        "Bowls",
        750,
        "Oats soaked in milk, with fruit and seeds.",
      ),
    ],
  },
];

export function starterMenu(id: StarterMenuId): StarterMenu {
  return STARTER_MENUS.find((m) => m.id === id)!;
}

/**
 * The item's starting price in the cafe's currency and unit, or null in a
 * currency with no price level, for the owner to fill in.
 */
export function starterPrice(
  usdCents: number,
  settings: MoneySettings,
): number | null {
  const level = STARTER_PRICE_LEVELS[settings.currency];
  if (!level) return null;
  const scale = 10 ** moneyDigits(settings);
  // In the stored unit; whole units for a cafe that stores them (TOE).
  const step = Math.max(1, Math.round(level.step * scale));
  const exact = (usdCents / 100) * level.perDollar * scale;
  return Math.max(step, Math.round(exact / step) * step);
}

/** Does the starter menu come priced in this currency? */
export function hasStarterPrices(settings: MoneySettings): boolean {
  return STARTER_PRICE_LEVELS[settings.currency] !== undefined;
}

/** The starter menu as CSV, for the import to check and the owner to edit. */
export function starterMenuCsv(
  id: StarterMenuId,
  settings: ImportSettings,
): string {
  return menuToCsv(
    starterMenu(id).items.map((i) => ({
      name: i.name,
      category: i.category,
      description: i.description,
      price: starterPrice(i.usdCents, settings),
      available: true,
    })),
    settings,
  );
}
