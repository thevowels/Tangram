// Friendly random nicknames ("Swift Fox"), offered when a player doesn't want to type one.

const ADJECTIVES = [
  "Swift", "Clever", "Brave", "Sunny", "Lucky", "Mighty", "Quiet", "Happy", "Bright", "Gentle",
  "Bold", "Witty", "Nimble", "Jolly", "Calm", "Daring", "Cosmic", "Golden", "Little", "Silver",
  "Speedy", "Sleepy", "Curious", "Fuzzy", "Merry", "Cheeky", "Dreamy", "Zippy", "Wise", "Plucky",
];

// animals that also appear among the puzzles
const ANIMALS = [
  "Fox", "Cat", "Swan", "Crane", "Rabbit", "Bear", "Fish", "Owl", "Duck", "Horse",
  "Camel", "Turtle", "Goose", "Dog", "Panda", "Tiger", "Whale", "Penguin", "Koala", "Otter",
  "Heron", "Lark", "Seal", "Snail", "Deer", "Mouse", "Parrot", "Pony", "Llama", "Robin",
];

export const NAME_PARTS = { adjectives: ADJECTIVES, animals: ANIMALS };

const pick = <T,>(list: T[], random: () => number) => list[Math.floor(random() * list.length)];

/** A random "Adjective Animal" name, different from `avoid` when one is given. */
export function randomNickname(random = Math.random, avoid?: string): string {
  for (;;) {
    const name = `${pick(ADJECTIVES, random)} ${pick(ANIMALS, random)}`;
    if (name !== avoid) return name;
  }
}
