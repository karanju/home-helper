// One household, three ages: the same screen everywhere, with these knobs per age group.
export const AGE_CONFIG = {
  kid: {
    label: 'Kid',
    badge: 'Under 13',
    avatar: '🧒',
    greeting: 'Hi, Super Helper! Here are your quests for today.',
    accent: '#f59e0b',
    accentSoft: 'rgba(245, 158, 11, 0.15)',
    font: 'var(--font-kid)',
    listTitle: 'My Chore Quests',
    navLabel: 'Quests',
    seesWholeFamily: false,
    canAddChores: false,
    canAssignOthers: false,
    reward: { unit: 'Stars', icon: '⭐' },
    helperName: 'Buddy',
    helperIntro: 'Hi! I am Buddy. Tap a chore\'s "How?" button or a question below and I will help you!',
    helperFreeText: false,
    helperPrompts: [
      'Can you give me a fun way to clean my room?',
      'How do I help get ready for dinner?',
      'What is a good chore I can do by myself?'
    ],
    safetyNote: 'Safe mode: Buddy only suggests kid-safe chores. Ask a grown-up for anything hot, sharp, or with cleaning sprays.'
  },
  teen: {
    label: 'Teen',
    badge: '13–17',
    avatar: '🧑',
    greeting: 'Your chores, plus a helper for cooking and getting things done.',
    accent: '#06b6d4',
    accentSoft: 'rgba(6, 182, 212, 0.15)',
    font: 'var(--font-main)',
    listTitle: 'My Chores',
    navLabel: 'Chores',
    seesWholeFamily: false,
    canAddChores: true,
    canAssignOthers: false,
    reward: { unit: 'pts', icon: '⚡' },
    helperName: 'Home Guide',
    helperIntro: 'Hey! Ask me how to do any chore, or for an easy recipe. I\'ll flag safety stuff when heat, knives, or chemicals are involved.',
    helperFreeText: true,
    helperPrompts: [
      'How do I make a quick dinner for the family?',
      'How do I get a stain out of a shirt?',
      'Help me plan my chores around homework'
    ],
    safetyNote: 'Safety reminders are included whenever stoves, knives, or cleaning chemicals come up.'
  },
  adult: {
    label: 'Adult',
    badge: '18+',
    avatar: '👤',
    greeting: 'The whole family\'s chores in one place. Assign, track, and plan.',
    accent: '#10b981',
    accentSoft: 'rgba(16, 185, 129, 0.15)',
    font: 'var(--font-main)',
    listTitle: 'Family Chores',
    navLabel: 'Chores',
    seesWholeFamily: true,
    canAddChores: true,
    canAssignOthers: true,
    reward: null,
    helperName: 'Home Assistant',
    helperIntro: 'I can explain any chore in detail, plan meals and groceries, or suggest a fair, age-appropriate way to split chores across the family.',
    helperFreeText: true,
    helperPrompts: [
      'Plan 3 family dinners and a grocery list',
      'Suggest age-appropriate chores for a 9 and 15 year old',
      'A 45-minute weekend whole-house clean routine'
    ],
    safetyNote: null
  }
};

export const MEMBERS = ['kid', 'teen', 'adult'];

// Built-in steps are shown when AI help isn't available (e.g. ai-chat is off for this player)
export const SEED_CHORES = [
  { id: 1, emoji: '🛏️', title: 'Make your bed', assignee: 'kid', points: 10, done: false, guideImage: '/images/make-bed.svg',
    steps: ['Pull the sheet and blanket up to the top.', 'Smooth out the bumps with your hands.', 'Put your pillow at the top. Done!'] },
  { id: 2, emoji: '🧸', title: 'Put toys back in the toy box', assignee: 'kid', points: 15, done: false, guideImage: '/images/put-away-toys.svg',
    steps: ['Pick one kind of toy to start with.', 'Put each one back where it lives.', 'Check under the bed for hiding toys!'] },
  { id: 3, emoji: '🍽️', title: 'Set the table for dinner', assignee: 'kid', points: 15, done: false,
    steps: ['Put a plate at each seat.', 'Fork on the left, spoon on the right.', 'Add a napkin and a cup for everyone.'] },
  { id: 4, emoji: '🎒', title: 'Pack your backpack for tomorrow', assignee: 'kid', points: 10, done: false, guideImage: '/images/pack-backpack.svg',
    steps: ['Heavy books go in first, at the back.', 'Folders and homework go in the middle.', 'Pencil case and snack go in the front pocket.'] },
  { id: 11, emoji: '👕', title: 'Fold your clothes', assignee: 'kid', points: 15, done: false, guideImage: '/images/fold-clothes.png',
    steps: ['Lay one shirt flat on a clean surface.', 'Fold each side toward the middle, then fold the bottom up.', 'Stack the folded clothes neatly.'] },
  { id: 5, emoji: '🍽️', title: 'Load and run the dishwasher', assignee: 'teen', points: 20, done: false,
    steps: ['Scrape food into the trash; no need to pre-rinse fully.', 'Plates face the center on the bottom rack; cups and bowls go upside down on top.', 'Knives point down in the basket.', 'Add detergent, close, and start a normal cycle.'] },
  { id: 6, emoji: '👕', title: 'Wash and fold a load of laundry', assignee: 'teen', points: 25, done: false,
    steps: ['Sort darks from lights and check pockets.', 'Use cold water and the amount of detergent on the cap line.', 'Dry on low or medium heat; clean the lint trap first.', 'Fold right away to avoid wrinkles.'] },
  { id: 7, emoji: '🗑️', title: 'Take out trash and recycling', assignee: 'teen', points: 15, done: false,
    steps: ['Tie the trash bag closed and carry it from the bottom.', 'Rinse and flatten recyclables.', 'Put a fresh bag in the can.'] },
  { id: 8, emoji: '🧽', title: 'Wipe down kitchen counters', assignee: 'adult', points: 0, done: false,
    steps: ['Clear the counters and crumbs.', 'Spray with an all-purpose cleaner and let it sit 1–2 minutes.', 'Wipe from back to front and dry with a clean cloth.'] },
  { id: 9, emoji: '🛒', title: 'Plan meals and the grocery list', assignee: 'adult', points: 0, done: false,
    steps: ['Check what is already in the fridge and pantry.', 'Pick 3–5 dinners that share ingredients.', 'Group the list by store section.'] },
  { id: 10, emoji: '🚿', title: 'Clean the bathroom', assignee: 'adult', points: 0, done: false,
    steps: ['Open a window or run the fan before using cleaners.', 'Spray the tub, sink, and toilet; never mix bleach with other cleaners.', 'Scrub, rinse, and mop the floor last.'] }
];
