
/* ============================================================================
 * ENAO AI — UNIVERSAL PRE-SET SYSTEM (Piece 07)
 * ----------------------------------------------------------------------------
 * Raja's rule (voice call, 22 Nov 2026 ~1:07-1:10 PM PKT): PORTFOLIO was
 * ONLY an example. ENZO must have every kind of build PRE-SET inside it
 * — fields, standards, templates, written UNIVERSALLY (how a template
 * should be, unique every time, what kinds exist) — so Raja says ONE
 * LINE ('portfolio bana do', or any website/app name, in English, Urdu,
 * Roman Urdu or mixed) and ENZO understands what it is and builds it
 * completely. Applies to ANY kind of website/app — never stop at
 * portfolio. Portfolio is one registry entry only; no portfolio
 * special-casing exists anywhere in the logic below.
 *
 * Build flow (1:09 PM PKT, locked): ENZO thinks what to do -> researches
 * on the internet how that kind of site/app should be -> asks Raja
 * questions (Q&A) for what it does not know -> then builds.
 *
 * What this piece does:
 *  - BUILD_KINDS registry: every build kind with the fields it needs
 *    (content), its standard sections/structure, and what makes it that
 *    kind. resolveBuildKind(oneLineCommand) maps a one-line command in
 *    English / Urdu script / Roman Urdu / mixed to a kind + plan outline.
 *  - buildPlan(kind, knownInfo): full plan for the kind — sections,
 *    fields, which fields are known vs unknown. Unknown fields become
 *    EDITABLE PLACEHOLDERS — never invented facts (no fake name, bio,
 *    stats, projects, prices).
 *  - nextDesign(kind, previousDesigns): a FRESH design direction every
 *    time (different palette, layout, motion style) — never repeats the
 *    previous design for the same kind; design history is recorded so
 *    repeats are detectable (designSignature / isRepeatDesign).
 *  - DESIGN_STANDARDS: professional, 3D elements, everything moving,
 *    living cards, website feels ALIVE not dead, fresh design every
 *    time, complex coding, amazing UI/UX — permanently set, not
 *    per-request. Every plan carries them.
 *  - appliesTo(kind): proves universality — the same functions work for
 *    every registered kind through the same code path.
 *
 * What it does NOT do:
 *  - No building of the actual site/app (that is the assembler / agents
 *    step, fed by buildPlan). This piece only resolves, plans and
 *    designs.
 *  - No internet research itself: BUILD_FLOW names the research step;
 *    the research is done by the agents (piece 06) and the Q&A by the
 *    conversation layer. This piece never invents research results.
 *  - No invented content: a field with no known value is a placeholder,
 *    never a guessed name, bio, stat, project or price.
 *
 * Style: plain ES5, no dependencies, no emojis anywhere.
 * ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Small helpers (same shape as 06-agents.js)                          */
  /* ------------------------------------------------------------------ */

  function asString(v) {
    if (typeof v === 'string') return v;
    if (v === null || v === undefined) return '';
    return String(v);
  }

  function asNonEmptyString(v) {
    var s = asString(v).replace(/^\s+|\s+$/g, '');
    return s ? s : null;
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /* Normalise for matching: lower-case, collapse whitespace, strip
     surrounding punctuation. Urdu-script words are kept as tokens. */
  function normText(text) {
    var s = asString(text).toLowerCase();
    s = s.replace(/[\u0600-\u06FF]+/g, function (m) { return ' ' + m + ' '; });
    s = s.replace(/[.,!?;:()\[\]"'“”‘’—–\-]+/g, ' ');
    s = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    return s;
  }

  function hasUrduScript(text) {
    return /[\u0600-\u06FF]/.test(asString(text));
  }

  var ROMAN_URDU_WORDS = [
    'mujhe', 'mujh', 'mera', 'meri', 'mere', 'bana', 'banao', 'banaa',
    'banaa', 'do', 'de', 'dena', 'ek', 'ki', 'ka', 'ke', 'ko', 'se',
    'mein', 'par', 'aur', 'chahiye', 'chahta', 'chahti', 'karo', 'kar',
    'do', 'website', 'site', 'wala', 'wali', 'wale', 'liye', 'acha',
    'achha', 'zabardast', 'kamaal'
  ];

  function detectLanguage(text) {
    var raw = asString(text);
    if (hasUrduScript(raw)) return 'ur';
    var words = normText(raw).split(' ');
    var hits = 0;
    for (var i = 0; i < words.length; i++) {
      if (ROMAN_URDU_WORDS.indexOf(words[i]) !== -1) hits++;
    }
    if (hits > 0) return 'roman';
    return 'en';
  }

  /* ------------------------------------------------------------------ */
  /* DESIGN_STANDARDS — permanently set, used by the whole system        */
  /* ------------------------------------------------------------------ */
  /* Raja, 22 Nov 2026 ~1:07 PM: design/UI/UX hamesha kamaal ka ho —
     professional tareeqe se, 3D cheezein, har cheez hilti-julti, cards
     zinda lagain — website ZINDA lage, murda nahi. Har website NAYE
     design ke saath bane (design repeat nahi). Complex coding + kamaal
     UI/UX permanently system mein set hon. These are NOT per-request
     options; every buildPlan carries them. */
  var DESIGN_STANDARDS = {
    professional: true,
    three_dimensional: true,
    everything_moves: true,
    living_cards: true,
    feels_alive_not_dead: true,
    fresh_design_every_time: true,
    complex_coding: true,
    amazing_ui_ux: true,
    rules: [
      'Professional layout: clear hierarchy, generous spacing, readable type.',
      '3D elements: depth, layers, perspective, shadows — never flat.',
      'Everything moves: animations on load, scroll, hover and interaction.',
      'Living cards: cards react, tilt, lift and animate — they feel alive.',
      'The website feels ALIVE, not dead: motion everywhere, never static.',
      'Fresh design every time: never repeat the previous design for the same kind.',
      'Complex coding: real structure, real components, no placeholder layout.',
      'Amazing UI/UX: the experience is the product, not an afterthought.'
    ]
  };

  /* ------------------------------------------------------------------ */
  /* TEMPLATE RULES — how a template should be, written universally      */
  /* ------------------------------------------------------------------ */
  var TEMPLATE_RULES = {
    unique_every_time: true,
    kinds: 'every registered kind has its own template shape; no kind reuses another kind\'s template',
    rules: [
      'A template is a structure + design direction, never finished content.',
      'Every build gets a UNIQUE template: palette, layout and motion differ from the previous build of the same kind.',
      'Template kinds: hero-led, card-grid, split-scroll, immersive-3D, dashboard-grid, story-feed, storefront-grid.',
      'A template must fit the kind: a store template shows products and prices; a blog template shows articles; a dashboard template shows data — never the wrong shape for the kind.',
      'Content slots are editable placeholders until Raja gives the real content.',
      'A template never invents content to fill its own slots.'
    ]
  };

  /* ------------------------------------------------------------------ */
  /* BUILD_FLOW — think -> research -> Q&A -> build (locked 1:09 PM)    */
  /* ------------------------------------------------------------------ */
  var BUILD_FLOW = [
    { step: 1, name: 'think', what: 'ENZO itself decides what the build needs: kind, sections, fields.' },
    { step: 2, name: 'research', what: 'ENZO researches on the internet how that kind of website/app should be.' },
    { step: 3, name: 'ask', what: 'ENZO asks Raja questions (Q&A) for what it does not know yet.' },
    { step: 4, name: 'build', what: 'ENZO builds it completely from the plan, with the design standards applied.' }
  ];

  /* ------------------------------------------------------------------ */
  /* BUILD_KINDS registry                                                */
  /* ------------------------------------------------------------------ */
  /* Each kind: id, label, keywords (en / roman / ur — matched against
     the one-line command), fields (content the build needs), sections
     (standard structure), identity (what makes it that kind). Portfolio
     is one entry among ten; nothing in the logic treats it specially. */
  var BUILD_KINDS = [
    {
      id: 'portfolio',
      label: 'Portfolio',
      keywords: ['portfolio', 'port folio', 'پورٹ فولیو'],
      identity: 'A personal showcase: one person, their work, their skills, and how to reach them.',
      fields: [
        { name: 'name', label: 'Full name', required: true, description: 'The person the portfolio is about.' },
        { name: 'title', label: 'Professional title', required: true, description: 'What the person does (e.g. developer, designer).' },
        { name: 'bio', label: 'Short bio', required: true, description: 'A few lines about the person.' },
        { name: 'skills', label: 'Skills', required: true, description: 'List of skills with levels.' },
        { name: 'projects', label: 'Projects', required: true, description: 'Real projects with title, description and link.' },
        { name: 'experience', label: 'Experience', required: false, description: 'Work history, roles and dates.' },
        { name: 'contact', label: 'Contact details', required: true, description: 'Email / social links for reaching the person.' }
      ],
      sections: [
        { id: 'hero', title: 'Hero', purpose: 'Name, title and one-line introduction.' },
        { id: 'about', title: 'About', purpose: 'Bio and background.' },
        { id: 'skills', title: 'Skills', purpose: 'Skills with levels.' },
        { id: 'projects', title: 'Projects', purpose: 'Real projects, each with a card.' },
        { id: 'experience', title: 'Experience', purpose: 'Work history timeline.' },
        { id: 'contact', title: 'Contact', purpose: 'How to reach the person.' }
      ]
    },
    {
      id: 'business',
      label: 'Business / Company Website',
      keywords: ['business', 'company', 'corporate', 'agency', 'firm', 'karobar', 'کاروبار', 'کمپنی'],
      identity: 'A company site: what the business does, its services, proof, and how to contact it.',
      fields: [
        { name: 'company_name', label: 'Company name', required: true, description: 'The business name.' },
        { name: 'tagline', label: 'Tagline', required: true, description: 'One line saying what the business does.' },
        { name: 'services', label: 'Services', required: true, description: 'List of services offered.' },
        { name: 'about', label: 'About the business', required: true, description: 'What the business is and why it exists.' },
        { name: 'testimonials', label: 'Testimonials', required: false, description: 'Real customer words.' },
        { name: 'contact', label: 'Contact details', required: true, description: 'Address, phone, email.' }
      ],
      sections: [
        { id: 'hero', title: 'Hero', purpose: 'Company name, tagline, call to action.' },
        { id: 'services', title: 'Services', purpose: 'What the business offers.' },
        { id: 'about', title: 'About', purpose: 'The business story.' },
        { id: 'why_us', title: 'Why Us', purpose: 'Reasons to choose this business.' },
        { id: 'testimonials', title: 'Testimonials', purpose: 'Real customer words.' },
        { id: 'contact', title: 'Contact', purpose: 'How to reach the business.' }
      ]
    },
  // 'app landing page' is a more specific kind than a generic landing
  // page, so it sits first: on an equal keyword score the earlier
  // (more specific) registry entry wins the tie.
    {
      id: 'app_landing',
      label: 'App Landing Page',
      keywords: ['app landing', 'mobile app', 'app', 'ایپ'],
      identity: 'A page for one app: what it does, screenshots, and where to download it.',
      fields: [
        { name: 'app_name', label: 'App name', required: true, description: 'The app name.' },
        { name: 'description', label: 'App description', required: true, description: 'What the app does.' },
        { name: 'features', label: 'Features', required: true, description: 'Key features of the app.' },
        { name: 'screenshots', label: 'Screenshots', required: false, description: 'Real screenshots of the app.' },
        { name: 'download_links', label: 'Download links', required: true, description: 'Real store links (Play Store / App Store).' }
      ],
      sections: [
        { id: 'hero', title: 'Hero', purpose: 'App name, promise, download buttons.' },
        { id: 'features', title: 'Features', purpose: 'What the app can do.' },
        { id: 'screenshots', title: 'Screenshots', purpose: 'The app in use.' },
        { id: 'download', title: 'Download', purpose: 'Store links.' }
      ]
    },
    {
      id: 'landing',
      label: 'Landing Page',
      keywords: ['landing page', 'landing', 'لینڈنگ پیج'],
      identity: 'A single-purpose page: one offer, one action, built to convert.',
      fields: [
        { name: 'offer', label: 'Offer', required: true, description: 'The one thing being offered.' },
        { name: 'headline', label: 'Headline', required: true, description: 'The main promise.' },
        { name: 'benefits', label: 'Benefits', required: true, description: 'Why the offer helps.' },
        { name: 'call_to_action', label: 'Call to action', required: true, description: 'The one action the visitor should take.' },
        { name: 'social_proof', label: 'Social proof', required: false, description: 'Real numbers or quotes that back the offer.' }
      ],
      sections: [
        { id: 'hero', title: 'Hero', purpose: 'Headline, offer, call to action.' },
        { id: 'benefits', title: 'Benefits', purpose: 'Why it helps.' },
        { id: 'proof', title: 'Proof', purpose: 'Real numbers or quotes.' },
        { id: 'cta', title: 'Call to Action', purpose: 'The final action step.' }
      ]
    },
    {
      id: 'blog',
      label: 'Blog',
      keywords: ['blog', 'بلاگ'],
      identity: 'A writing site: articles, categories, and a way to follow new posts.',
      fields: [
        { name: 'blog_name', label: 'Blog name', required: true, description: 'The blog title.' },
        { name: 'author', label: 'Author', required: true, description: 'Who writes the blog.' },
        { name: 'topics', label: 'Topics', required: true, description: 'What the blog writes about.' },
        { name: 'articles', label: 'Articles', required: true, description: 'Real articles with title, text and date.' },
        { name: 'about', label: 'About', required: false, description: 'About the blog and the author.' }
      ],
      sections: [
        { id: 'hero', title: 'Hero', purpose: 'Blog name and what it covers.' },
        { id: 'featured', title: 'Featured Article', purpose: 'The newest or best article.' },
        { id: 'articles', title: 'Articles', purpose: 'Article list with categories.' },
        { id: 'about', title: 'About', purpose: 'About the author.' },
        { id: 'subscribe', title: 'Subscribe', purpose: 'Follow new posts.' }
      ]
    },
    {
      id: 'store',
      label: 'Online Store',
      keywords: ['online store', 'ecommerce', 'e-commerce', 'online shop', 'shop', 'store', 'dukaan', 'آن لائن اسٹور', 'دکان'],
      identity: 'A shop: real products with real prices, a cart, and checkout.',
      fields: [
        { name: 'store_name', label: 'Store name', required: true, description: 'The shop name.' },
        { name: 'products', label: 'Products', required: true, description: 'Real products with name, price and image.' },
        { name: 'categories', label: 'Categories', required: true, description: 'Product categories.' },
        { name: 'shipping', label: 'Shipping info', required: false, description: 'Delivery options and cost.' },
        { name: 'payment', label: 'Payment methods', required: true, description: 'How customers pay.' },
        { name: 'contact', label: 'Contact details', required: true, description: 'Support contact.' }
      ],
      sections: [
        { id: 'hero', title: 'Hero', purpose: 'Store name and featured offer.' },
        { id: 'categories', title: 'Categories', purpose: 'Browse by category.' },
        { id: 'products', title: 'Products', purpose: 'Product grid with prices.' },
        { id: 'cart', title: 'Cart', purpose: 'What the visitor is buying.' },
        { id: 'checkout', title: 'Checkout', purpose: 'Pay and finish the order.' },
        { id: 'contact', title: 'Contact', purpose: 'Support contact.' }
      ]
    },
    {
      id: 'dashboard',
      label: 'Dashboard',
      keywords: ['dashboard', 'admin panel', 'admin', 'ڈیش بورڈ'],
      identity: 'A data view: live numbers, charts, and controls for managing something.',
      fields: [
        { name: 'dashboard_name', label: 'Dashboard name', required: true, description: 'What the dashboard manages.' },
        { name: 'metrics', label: 'Key metrics', required: true, description: 'The numbers that matter, and where they come from.' },
        { name: 'charts', label: 'Charts', required: true, description: 'What each chart shows.' },
        { name: 'data_source', label: 'Data source', required: true, description: 'Where the data comes from.' },
        { name: 'users', label: 'Users / roles', required: false, description: 'Who can see and change what.' }
      ],
      sections: [
        { id: 'overview', title: 'Overview', purpose: 'Key numbers at a glance.' },
        { id: 'charts', title: 'Charts', purpose: 'Trends and breakdowns.' },
        { id: 'tables', title: 'Tables', purpose: 'Detailed rows.' },
        { id: 'settings', title: 'Settings', purpose: 'Controls and configuration.' }
      ]
    },
    {
      id: 'restaurant',
      label: 'Restaurant / Cafe Site',
      keywords: ['restaurant', 'cafe', 'coffee shop', 'food', 'menu', 'khana', 'ریسٹورنٹ', 'کیفے'],
      identity: 'A place to eat: the menu with real prices, location, hours, and booking.',
      fields: [
        { name: 'restaurant_name', label: 'Restaurant name', required: true, description: 'The restaurant name.' },
        { name: 'menu', label: 'Menu', required: true, description: 'Real dishes with real prices.' },
        { name: 'location', label: 'Location', required: true, description: 'Address and map.' },
        { name: 'hours', label: 'Opening hours', required: true, description: 'When it is open.' },
        { name: 'booking', label: 'Booking info', required: false, description: 'How to reserve a table.' },
        { name: 'contact', label: 'Contact details', required: true, description: 'Phone and social links.' }
      ],
      sections: [
        { id: 'hero', title: 'Hero', purpose: 'Restaurant name and signature dish.' },
        { id: 'menu', title: 'Menu', purpose: 'Dishes with prices.' },
        { id: 'about', title: 'About', purpose: 'The place and its story.' },
        { id: 'visit', title: 'Visit Us', purpose: 'Location, hours, booking.' },
        { id: 'contact', title: 'Contact', purpose: 'Phone and links.' }
      ]
    },
    {
      id: 'school',
      label: 'School / Education Site',
      keywords: ['school', 'college', 'education', 'academy', 'course', 'courses', 'taleem', 'اسکول', 'تعلیم'],
      identity: 'A learning site: courses or classes, teachers, admissions, and how to join.',
      fields: [
        { name: 'school_name', label: 'School name', required: true, description: 'The school or academy name.' },
        { name: 'courses', label: 'Courses / classes', required: true, description: 'Real courses with subjects and levels.' },
        { name: 'teachers', label: 'Teachers', required: true, description: 'Real teachers and their subjects.' },
        { name: 'admissions', label: 'Admissions info', required: true, description: 'How to join, fees, dates.' },
        { name: 'contact', label: 'Contact details', required: true, description: 'Address, phone, email.' }
      ],
      sections: [
        { id: 'hero', title: 'Hero', purpose: 'School name and promise.' },
        { id: 'courses', title: 'Courses', purpose: 'What is taught.' },
        { id: 'teachers', title: 'Teachers', purpose: 'Who teaches.' },
        { id: 'admissions', title: 'Admissions', purpose: 'How to join.' },
        { id: 'contact', title: 'Contact', purpose: 'How to reach the school.' }
      ]
    },
    {
      id: 'news',
      label: 'News Site',
      keywords: ['news', 'newspaper', 'khabar', 'khabrein', 'خبر', 'خبریں'],
      identity: 'A news site: real stories, categories, and the latest first.',
      fields: [
        { name: 'site_name', label: 'News site name', required: true, description: 'The news site name.' },
        { name: 'categories', label: 'Categories', required: true, description: 'News categories covered.' },
        { name: 'articles', label: 'Articles', required: true, description: 'Real news stories with headline, text and date.' },
        { name: 'authors', label: 'Authors', required: false, description: 'Who writes the stories.' },
        { name: 'contact', label: 'Contact details', required: false, description: 'Tips and contact.' }
      ],
      sections: [
        { id: 'top', title: 'Top Stories', purpose: 'The biggest stories right now.' },
        { id: 'latest', title: 'Latest', purpose: 'Newest stories first.' },
        { id: 'categories', title: 'Categories', purpose: 'Browse by topic.' },
        { id: 'article', title: 'Article', purpose: 'One full story.' }
      ]
    }
  ];

  var KIND_BY_ID = {};
  (function () {
    for (var i = 0; i < BUILD_KINDS.length; i++) {
      KIND_BY_ID[BUILD_KINDS[i].id] = BUILD_KINDS[i];
    }
  })();

  function listBuildKinds() {
    var out = [];
    for (var i = 0; i < BUILD_KINDS.length; i++) {
      out.push(BUILD_KINDS[i].id);
    }
    return out;
  }

  function getBuildKind(kindId) {
    return KIND_BY_ID[asString(kindId)] || null;
  }

  /* appliesTo(kind): the same functions work for every registered kind.
     No portfolio special-casing: portfolio is one registry entry, and
     this check is identical for all ten kinds. */
  function appliesTo(kindId) {
    return getBuildKind(kindId) !== null;
  }

  /* ------------------------------------------------------------------ */
  /* resolveBuildKind(oneLineCommand)                                    */
  /* ------------------------------------------------------------------ */
  /* One line in English / Urdu script / Roman Urdu / mixed -> the build
     kind + a short plan outline. Pure function. Returns
     { raw, lang, kind, kindLabel, matched, outline, gap, note }.
     kind is null when no registered kind matches — the piece never
     guesses a kind. */
  function resolveBuildKind(command) {
    var raw = asString(command);
    var lang = detectLanguage(raw);
    var base = {
      raw: raw, lang: lang, kind: null, kindLabel: null,
      matched: [], outline: [], gap: null, note: null
    };
    var n = normText(raw);
    if (!n) {
      base.gap = 'empty';
      return base;
    }
    var padded = ' ' + n + ' ';
    var best = null;
    var bestScore = 0;
    var bestMatched = [];
    for (var i = 0; i < BUILD_KINDS.length; i++) {
      var kind = BUILD_KINDS[i];
      var score = 0;
      var matched = [];
      for (var j = 0; j < kind.keywords.length; j++) {
        var kw = normText(kind.keywords[j]);
        if (!kw) continue;
        /* Multi-word keywords match as a phrase; single words match
           whole tokens only, so "app" never matches inside "apple". */
        if (kw.indexOf(' ') !== -1) {
          if (padded.indexOf(' ' + kw + ' ') !== -1) {
            score += kw.split(' ').length * 2;
            matched.push(kind.keywords[j]);
          }
        } else if (padded.indexOf(' ' + kw + ' ') !== -1) {
          score += 2;
          matched.push(kind.keywords[j]);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = kind;
        bestMatched = matched;
      }
    }
    if (!best) {
      base.gap = 'unknown-kind';
      base.note = 'No registered build kind matches that line — ask which kind of website or app it is.';
      return base;
    }
    base.kind = best.id;
    base.kindLabel = best.label;
    base.matched = bestMatched;
    base.outline = planOutline(best);
    return base;
  }

  function planOutline(kind) {
    var out = [];
    for (var i = 0; i < kind.sections.length; i++) {
      out.push(kind.sections[i].title + ': ' + kind.sections[i].purpose);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* buildPlan(kind, knownInfo)                                          */
  /* ------------------------------------------------------------------ */
  /* Full plan for the kind: sections, fields, which fields are known
     vs unknown. knownInfo is an object of field name -> real value
     (only values Raja actually gave). An unknown field becomes an
     EDITABLE PLACEHOLDER — value stays null, placeholder text says so
     plainly. Nothing is invented: no fake name, bio, stat, project
     or price ever appears in a plan. */
  function buildPlan(kindId, knownInfo) {
    var kind = getBuildKind(kindId);
    if (!kind) return null;
    var known = isPlainObject(knownInfo) ? knownInfo : {};
    var fields = [];
    var knownCount = 0;
    var unknownCount = 0;
    var placeholders = [];
    for (var i = 0; i < kind.fields.length; i++) {
      var f = kind.fields[i];
      var value = asNonEmptyString(known[f.name]);
      var entry = {
        name: f.name,
        label: f.label,
        required: f.required,
        description: f.description,
        known: value !== null,
        value: value,
        placeholder: value === null,
        placeholderText: value === null
          ? ('[EDITABLE: ' + f.label + ' — fill in the real ' + f.label.toLowerCase() + ']')
          : null
      };
      if (value !== null) knownCount++;
      else {
        unknownCount++;
        placeholders.push(entry.placeholderText);
      }
      fields.push(entry);
    }
    var sections = [];
    for (var j = 0; j < kind.sections.length; j++) {
      sections.push({
        id: kind.sections[j].id,
        title: kind.sections[j].title,
        purpose: kind.sections[j].purpose
      });
    }
    return {
      kind: kind.id,
      kindLabel: kind.label,
      identity: kind.identity,
      sections: sections,
      fields: fields,
      knownCount: knownCount,
      unknownCount: unknownCount,
      placeholders: placeholders,
      designStandards: DESIGN_STANDARDS,
      templateRules: TEMPLATE_RULES,
      buildFlow: BUILD_FLOW,
      complete: unknownCount === 0,
      outline: planOutline(kind)
    };
  }

  /* ------------------------------------------------------------------ */
  /* Design directions — fresh every time, never a repeat                */
  /* ------------------------------------------------------------------ */
  var PALETTES = [
    { id: 'aurora', name: 'Aurora', colors: ['#0f172a', '#7c3aed', '#22d3ee'] },
    { id: 'ember', name: 'Ember', colors: ['#1c0a00', '#ea580c', '#fbbf24'] },
    { id: 'forest', name: 'Forest', colors: ['#052e16', '#16a34a', '#a3e635'] },
    { id: 'ocean', name: 'Ocean', colors: ['#082f49', '#0284c7', '#67e8f9'] },
    { id: 'rose', name: 'Rose', colors: ['#2a0a1e', '#db2777', '#fda4af'] },
    { id: 'mono', name: 'Mono Ink', colors: ['#111111', '#f5f5f5', '#6366f1'] }
  ];

  var LAYOUTS = [
    { id: 'hero-left', name: 'Hero Left', shape: 'hero-led' },
    { id: 'hero-center', name: 'Hero Center', shape: 'hero-led' },
    { id: 'split-scroll', name: 'Split Scroll', shape: 'split-scroll' },
    { id: 'card-grid', name: 'Card Grid', shape: 'card-grid' },
    { id: 'immersive-3d', name: 'Immersive 3D', shape: 'immersive-3D' }
  ];

  var MOTIONS = [
    { id: 'float-drift', name: 'Float Drift' },
    { id: 'parallax-scroll', name: 'Parallax Scroll' },
    { id: 'tilt-cards', name: 'Tilt Cards' },
    { id: 'morph-blob', name: 'Morph Blob' },
    { id: 'slide-reveal', name: 'Slide Reveal' }
  ];

  /* Design history, per kind, so repeats are detectable. Recorded by
     nextDesign; read by isRepeatDesign / getDesignHistory. */
  var designHistory = {}; /* kind id -> [signature, ...] in order */

  function designSignature(design) {
    if (!design) return '';
    return [design.paletteId, design.layoutId, design.motionId].join('|');
  }

  function isRepeatDesign(kindId, design) {
    var sig = designSignature(design);
    if (!sig) return false;
    var hist = designHistory[asString(kindId)] || [];
    return hist.indexOf(sig) !== -1;
  }

  function recordDesign(kindId, design) {
    var id = asString(kindId);
    var sig = designSignature(design);
    if (!sig) return false;
    if (!designHistory[id]) designHistory[id] = [];
    if (designHistory[id].indexOf(sig) === -1) designHistory[id].push(sig);
    return true;
  }

  function getDesignHistory(kindId) {
    var hist = designHistory[asString(kindId)] || [];
    return hist.slice();
  }

  /* nextDesign(kind, previousDesigns): returns a FRESH design direction
     for the kind — palette, layout, motion — that is not in the
     recorded history for that kind and not in previousDesigns (an
     optional array of design objects or signatures). Candidates are
     walked in a fixed order, so two successive calls for the same kind
     always differ. When every combination has been used, the variation
     counter increments so the direction is still fresh. */
  function nextDesign(kindId, previousDesigns) {
    var kind = getBuildKind(kindId);
    if (!kind) return null;
    var id = kind.id;
    var used = {};
    var hist = designHistory[id] || [];
    for (var h = 0; h < hist.length; h++) used[hist[h]] = true;
    if (Array.isArray(previousDesigns)) {
      for (var p = 0; p < previousDesigns.length; p++) {
        var sig = typeof previousDesigns[p] === 'string'
          ? previousDesigns[p]
          : designSignature(previousDesigns[p]);
        if (sig) used[sig] = true;
      }
    }
    var variation = 0;
    var chosen = null;
    for (var v = 0; v < 1000 && !chosen; v++) {
      for (var a = 0; a < PALETTES.length && !chosen; a++) {
        for (var b = 0; b < LAYOUTS.length && !chosen; b++) {
          for (var c = 0; c < MOTIONS.length && !chosen; c++) {
            var idx = v * PALETTES.length * LAYOUTS.length * MOTIONS.length
              + a * LAYOUTS.length * MOTIONS.length + b * MOTIONS.length + c;
            /* Rotate the walk start by history length so the first
               candidate changes as history grows. */
            var start = hist.length;
            var pick = (idx + start) %
              (PALETTES.length * LAYOUTS.length * MOTIONS.length);
            var pa = PALETTES[Math.floor(pick / (LAYOUTS.length * MOTIONS.length)) % PALETTES.length];
            var la = LAYOUTS[Math.floor(pick / MOTIONS.length) % LAYOUTS.length];
            var mo = MOTIONS[pick % MOTIONS.length];
            var candSig = pa.id + '|' + la.id + '|' + mo.id;
            if (!used[candSig]) {
              chosen = { palette: pa, layout: la, motion: mo, variation: v };
            }
          }
        }
      }
      variation = v;
    }
    if (!chosen) {
      /* Every combination used: still return a fresh direction by
         bumping the variation counter on the first combination. */
      chosen = { palette: PALETTES[0], layout: LAYOUTS[0], motion: MOTIONS[0], variation: variation + 1 };
    }
    var design = {
      kind: id,
      kindLabel: kind.label,
      paletteId: chosen.palette.id,
      palette: chosen.palette.name,
      colors: chosen.palette.colors.slice(),
      layoutId: chosen.layout.id,
      layout: chosen.layout.name,
      layoutShape: chosen.layout.shape,
      motionId: chosen.motion.id,
      motion: chosen.motion.name,
      variation: chosen.variation,
      designStandards: DESIGN_STANDARDS
    };
    design.signature = designSignature(design);
    recordDesign(id, design);
    return design;
  }

  /* ------------------------------------------------------------------ */
  /* API                                                                 */
  /* ------------------------------------------------------------------ */

  var api = {
    DESIGN_STANDARDS: DESIGN_STANDARDS,
    TEMPLATE_RULES: TEMPLATE_RULES,
    BUILD_FLOW: BUILD_FLOW,
    BUILD_KINDS: BUILD_KINDS,
    listBuildKinds: listBuildKinds,
    getBuildKind: getBuildKind,
    appliesTo: appliesTo,
    resolveBuildKind: resolveBuildKind,
    buildPlan: buildPlan,
    nextDesign: nextDesign,
    designSignature: designSignature,
    isRepeatDesign: isRepeatDesign,
    recordDesign: recordDesign,
    getDesignHistory: getDesignHistory,
    detectLanguage: detectLanguage,
    /* Test-only seam (not for production use): */
    _resetForTest: function () { designHistory = {}; }
  };

  try {
    if (typeof window !== 'undefined') window.EnzoUniversalPreset = api;
    if (typeof globalThis !== 'undefined') globalThis.EnzoUniversalPreset = api;
  } catch (e) { /* exposure is best-effort */ }

  /* Node / CommonJS export for the test harness (no effect in browser). */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
