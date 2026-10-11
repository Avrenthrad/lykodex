// Legal pages content: Privacy Policy, Terms of Service, Refund
// Policy, Cookie Policy. Rendered by components/LegalPage.jsx and
// linked from components/SiteFooter.jsx.
//
// Written against Australian law (Privacy Act 1988 / Australian
// Privacy Principles, Australian Consumer Law). These are good-faith
// drafts, not legal advice. Have them reviewed before relying on them.
//
// FILL IN: the remaining [BRACKETED] values in BUSINESS below. They're
// shown in the footer and inside every policy, so placeholders stay
// visible until replaced. abn is hidden while empty.
//
// Keep "What we collect" and "Who we share it with" in sync with
// docs/COMPLIANCE.md whenever a new data source or service is added.

export const BUSINESS = {
  name: "Lykosoft",
  team: "Lykodex Team",
  abn: "",
  email: "[CONTACT EMAIL]",
  state: "[YOUR STATE OR TERRITORY]",
};

export const MIN_AGE = 16;
export const LEGAL_LAST_UPDATED = "11 October 2026";

export const LEGAL_PAGES = [
  { id: "privacy", label: "Privacy Policy" },
  { id: "terms", label: "Terms of Service" },
  { id: "refunds", label: "Refund Policy" },
  { id: "cookies", label: "Cookie Policy" },
];

const contact = `${BUSINESS.team}, ${BUSINESS.name} — ${BUSINESS.email}`;

// Each page: { title, intro, sections: [{ heading, paragraphs?, list? }] }
export const LEGAL_CONTENT = {
  privacy: {
    title: "Privacy Policy",
    intro:
      `This policy explains what personal information Lykodex collects, why, and what you can do about it. Lykodex is run by the ${BUSINESS.team} at ${BUSINESS.name}${BUSINESS.abn ? ` (ABN ${BUSINESS.abn})` : ""}, and we follow the Australian Privacy Principles in the Privacy Act 1988 (Cth).`,
    sections: [
      {
        heading: "What we collect",
        list: [
          "Account details: your email address and password. Passwords are stored hashed by our authentication provider, never in plain text. If you sign in with Discord, Twitch or another provider, we receive the basic profile details that provider shares (such as your user ID, username and avatar).",
          "Profile details you choose to add: first and last name, username, avatar and wallpaper images, timezone, currency, gamertags and friend codes, and your display preferences. All of these are optional except an email address.",
          "Linked accounts you choose to connect: your Steam ID, and sign-in tokens for Xbox, PlayStation Network and Crunchyroll so we can fetch your libraries, achievements and trophies. You can unlink any of these at any time on the Account Linking page.",
          "Things you add: game libraries, wishlists, backlogs, achievements, card collections, decks and binders, books, comics, collectibles, tabletop campaigns, ratings, and any photos you upload.",
          "Social features: friends, friend requests, guild memberships, guild posts and comments, direct messages, and Marketplace listings and offers.",
          "Discord activity (only if you turn on Discord activity tracking): the game you're playing and for how long, time spent in voice chat, and what you're listening to or watching through Discord's status. It's off by default.",
          "API keys you paste in for third-party price services. These are used only to make those requests for you.",
          "Settings saved on your device (local storage), such as layout and dashboard preferences. See our Cookie Policy.",
        ],
      },
      {
        heading: "What we don't collect",
        list: [
          "We don't use advertising, analytics or tracking tools, and we don't build advertising profiles.",
          "We don't sell or rent your personal information to anyone.",
          "We don't ask for your date of birth, address, phone number or government ID.",
          "We never ask for or store your passwords for linked services. Steam, Discord and Twitch link through their own sign-in pages. For PlayStation Network and Crunchyroll, which have no official sign-in for apps, you paste a session code from your own browser. We use it once to get access tokens and don't keep the code itself.",
        ],
      },
      {
        heading: "Why we use it",
        list: [
          "To run your account and show your collections, prices and progress back to you.",
          "To calculate your Mastery scores, which combine the data you've added and linked.",
          "To power social features you choose to use, such as friends, guilds, the Marketplace and messages.",
          "To keep Lykodex secure and working, and to respond when you contact us.",
        ],
      },
      {
        heading: "What other people can see",
        paragraphs: [
          "Your username, avatar and public profile can be seen by other signed-in users. Your Marketplace listings, guild posts and comments are visible to the people they're shared with.",
          "Your activity (such as achievements, completions and new additions) is shared with your guilds, friends or Discord servers only if you turn on \"Share activity with guilds\". It's off by default.",
        ],
      },
      {
        heading: "Who we share it with",
        paragraphs: [
          "We use these service providers to run Lykodex. They only process your information to provide their service to us:",
        ],
        list: [
          "Supabase: database, sign-in and file storage. Data is stored in Japan (Tokyo region).",
          "Vercel: hosts the website and its server functions (United States and global edge network).",
          "Railway: hosts the Lykodex Discord bot (United States).",
          "Google Fonts: serves the website's fonts. Your browser requests the font files directly from Google, which receives your IP address.",
          "Services you link or search: when you link Steam, Xbox, PlayStation Network, Crunchyroll, Discord or Twitch, or look things up (for example game, card, book or price data), we send the request needed to that service. Each has its own privacy policy.",
        ],
      },
      {
        heading: "Overseas disclosure",
        paragraphs: [
          "Because our providers are based overseas, your information is stored and processed outside Australia, mainly in Japan and the United States. We choose providers with strong security practices, but overseas laws may differ from Australia's.",
        ],
      },
      {
        heading: "Security",
        paragraphs: [
          "Data is encrypted in transit. Access to your data is restricted by account-level database rules, so other users can only see what's meant to be shared. No system is perfectly secure; if a data breach is likely to cause you serious harm, we'll notify you and the OAIC as required by the Notifiable Data Breaches scheme.",
        ],
      },
      {
        heading: "Keeping and deleting your data",
        paragraphs: [
          "We keep your information while your account is open. You can delete your account at any time in Account Settings → Delete account. This permanently removes your profile, everything you've added, your uploaded images and your linked-account tokens straight away. Copies may remain in encrypted backups for a short period before they're overwritten.",
          `You can also ask us to delete your data by emailing ${BUSINESS.email}.`,
        ],
      },
      {
        heading: "Access and correction",
        paragraphs: [
          `You can see and edit most of your information directly in Lykodex. To ask for a copy of the personal information we hold about you, or to correct anything, contact ${BUSINESS.email}. We'll respond within 30 days.`,
        ],
      },
      {
        heading: "Age requirement",
        paragraphs: [
          `Lykodex is for people aged ${MIN_AGE} and over. We don't knowingly collect information from anyone younger. If you believe someone under ${MIN_AGE} has made an account, contact us and we'll delete it.`,
        ],
      },
      {
        heading: "Complaints",
        paragraphs: [
          `If you have a privacy concern, contact us first at ${BUSINESS.email} and we'll try to resolve it within 30 days. If you're not satisfied, you can complain to the Office of the Australian Information Commissioner (OAIC) at oaic.gov.au.`,
        ],
      },
      {
        heading: "Changes to this policy",
        paragraphs: [
          "If we make significant changes, we'll let you know in the app before they take effect. The date at the top shows when this policy was last updated.",
        ],
      },
    ],
  },

  terms: {
    title: "Terms of Service",
    intro:
      `These terms are an agreement between you and ${BUSINESS.name} ("we", "us"), who runs Lykodex. By creating an account or using Lykodex, you agree to them. Please read them along with our Privacy Policy.`,
    sections: [
      {
        heading: "Who can use Lykodex",
        paragraphs: [
          `You must be at least ${MIN_AGE} years old to create an account. You're responsible for keeping your login details secure and for what happens on your account.`,
        ],
      },
      {
        heading: "Your content",
        paragraphs: [
          "You keep ownership of everything you add to Lykodex, including collections, photos, posts and messages. You give us permission to store, display and process it only so we can run Lykodex for you and show it to the people you choose to share it with.",
          "Only upload content you have the right to share.",
        ],
      },
      {
        heading: "Acceptable use",
        paragraphs: ["Please don't:"],
        list: [
          "harass, threaten or impersonate other people, or post hateful, sexual or illegal content;",
          "use Lykodex to scam other users or post misleading Marketplace listings;",
          "try to access other people's accounts or data, or interfere with how Lykodex works;",
          "scrape, overload or resell the service, or use it to break another service's terms.",
        ],
      },
      {
        heading: "Marketplace",
        paragraphs: [
          "The Marketplace lets users list items and make offers to each other. Any sale or trade is between the users involved. Lykodex isn't a party to it, doesn't handle payments or shipping, and doesn't guarantee the items, their condition or the other person. Lykodex doesn't currently charge any fees for using the Marketplace.",
        ],
      },
      {
        heading: "Prices and third-party data",
        paragraphs: [
          "Prices, game details, card data and other information come from third-party sources and may be incomplete, delayed or wrong. Treat them as estimates and check with the seller before buying anything. Lykodex isn't affiliated with or endorsed by those sources or the platforms it connects to. All trademarks belong to their owners.",
        ],
      },
      {
        heading: "Mastery scores",
        paragraphs: [
          "Mastery scores and levels are Lykodex's own fun measure based on the data you've added or linked. Some inputs are self-reported. They aren't an official ranking from any platform.",
        ],
      },
      {
        heading: "Paid features",
        paragraphs: [
          "Lykodex is currently free. If we introduce paid features, the full price (including GST) and what you get will be shown clearly before you pay, with no hidden fees. Subscriptions can be cancelled at any time. See our Refund Policy.",
        ],
      },
      {
        heading: "Ending your account",
        paragraphs: [
          "You can delete your account at any time in Account Settings. We may suspend or close accounts that seriously or repeatedly break these terms. We'll tell you why where it's reasonable to do so.",
        ],
      },
      {
        heading: "Your rights under Australian Consumer Law",
        paragraphs: [
          "Nothing in these terms limits any rights you have under the Australian Consumer Law that can't legally be excluded. Apart from those rights, Lykodex is provided \"as is\". To the extent the law allows, we aren't liable for indirect losses or for losses caused by third-party services, and our total liability to you is limited to the amount you've paid us in the previous 12 months (or AUD $50 if you haven't paid us anything).",
        ],
      },
      {
        heading: "Changes and governing law",
        paragraphs: [
          "We may update these terms. If changes are significant, we'll tell you in the app before they take effect. Continuing to use Lykodex after that means you accept the new terms.",
          `These terms are governed by the laws of ${BUSINESS.state}, Australia.`,
        ],
      },
      {
        heading: "Contact",
        paragraphs: [contact],
      },
    ],
  },

  refunds: {
    title: "Refund Policy",
    intro: "Lykodex is currently free to use. We don't charge for accounts, features or the Marketplace, so there's nothing to refund today. This policy explains how refunds will work if paid features are added.",
    sections: [
      {
        heading: "Your consumer guarantees",
        paragraphs: [
          "Under the Australian Consumer Law, digital services come with guarantees that can't be excluded. If a paid feature has a major problem, you're entitled to a refund or to cancel. For a minor problem, we'll fix it within a reasonable time, and if we can't, you can ask for a refund.",
        ],
      },
      {
        heading: "Subscriptions",
        list: [
          "The full price, including GST, will be shown before you pay. No hidden fees.",
          "You can cancel at any time. Cancelling stops future charges, and you keep access until the end of the period you've paid for.",
          "If you're charged by mistake, or charged after cancelling, we'll refund you in full.",
          "If you change your mind within 14 days of your first payment and haven't made significant use of the paid feature, contact us for a full refund.",
        ],
      },
      {
        heading: "Marketplace purchases",
        paragraphs: [
          "Sales and trades between users on the Marketplace happen directly between those users. Lykodex doesn't take payment for them, so refunds for those items need to be sorted out with the other person.",
        ],
      },
      {
        heading: "How to ask for a refund",
        paragraphs: [
          `Email ${BUSINESS.email} with the email address on your account and what went wrong. We'll reply within 5 business days, and approved refunds go back to the original payment method.`,
        ],
      },
    ],
  },

  cookies: {
    title: "Cookie Policy",
    intro: "Lykodex doesn't use advertising, analytics or tracking cookies. We only store what's needed to keep you signed in and remember your settings.",
    sections: [
      {
        heading: "What we store on your device",
        list: [
          "Sign-in session (strictly necessary): keeps you logged in. It's stored in your browser's local storage by our sign-in provider, Supabase, and removed when you sign out.",
          "Your preferences (functional): dashboard layout, platform order, which feeds you've switched on, and when you last checked your activity. They're stored in local storage so the app looks the way you left it.",
          "Cookie notice: remembers that you've seen the cookie notice, so it doesn't show again.",
        ],
      },
      {
        heading: "Third parties",
        paragraphs: [
          "Your browser loads Lykodex's fonts from Google Fonts, which receives your IP address as part of that request. We don't load any advertising or analytics scripts.",
          "Linked services such as Steam, Discord or Twitch set their own cookies on their own websites when you sign in with them. Those are covered by their policies.",
        ],
      },
      {
        heading: "Managing them",
        paragraphs: [
          "Everything we store is needed for Lykodex to work or remember your settings, so there's nothing to opt out of. You can clear it at any time by signing out and clearing your browser's site data for Lykodex. You'll need to sign in again, and your device-only settings will reset.",
        ],
      },
      {
        heading: "Changes",
        paragraphs: [
          "If we ever add non-essential cookies, such as analytics, we'll ask for your consent first and update this policy.",
        ],
      },
    ],
  },
};
