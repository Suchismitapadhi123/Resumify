/*
  ============================================================
  FILE: script.js
  PURPOSE: All application logic for the AI Resume Builder.

  HOW THIS FILE IS ORGANISED:
    1.  State Object           — the single source of truth for all resume data
    2.  Section Definitions    — list of tabs / sections
    3.  Auto-Save (localStorage) — persists data across page refreshes
    4.  Tab Rendering          — builds the section tab buttons
    5.  Field Update Helpers   — functions that update state and re-render
    6.  Section Renderers      — HTML templates for each form section
    7.  Field Generator Helpers — tiny functions that build input HTML
    8.  Entry Management       — add / remove repeatable entries
    9.  Resume Preview Renderer— assembles the live resume HTML
   10.  View Toggle            — switch between split/edit/preview modes
   11.  Download Function      — open printable HTML in a new tab
   12.  Toast Notification     — show brief feedback messages
   13.  AI Summary Generator   — calls Claude API to write the summary
   14.  Initialisation         — runs on page load

  BUGS FIXED FROM ORIGINAL:
    ✔ fgl2() now receives arrKey as a parameter instead of
      reading the global currentSection — prevents wrong array
      being updated if section changes mid-render.
    ✔ Removed unused inp() helper function (dead code).
    ✔ Download no longer duplicates all CSS — uses a shared
      constant RESUME_PRINT_CSS.
    ✔ Added localStorage auto-save so data survives refresh.
    ✔ Added Clear/Reset button.

  NEW FEATURES:
    ✔ AI-powered Professional Summary generator (Claude API)
    ✔ Auto-save indicator badge
    ✔ Accessible aria attributes on rendered elements
  ============================================================
*/


/* ════════════════════════════════════════════════════════════
   1. STATE OBJECT
   WHY: All resume data lives in ONE place — this object.
        The UI reads from it, inputs write to it, and the
        preview renders from it. This pattern is called a
        "single source of truth" and makes debugging easy.

   STRUCTURE:
     personal      → flat object for basic contact info
     summary       → plain string for the summary paragraph
     skills        → flat object for four skill categories
     education     → array of education entry objects
     experience    → array of work experience entry objects
     internships   → array of internship entry objects
     projects      → array of project entry objects
     certifications→ array of certification entry objects
════════════════════════════════════════════════════════════ */
const state = {
  personal: {
    name:      '',
    email:     '',
    phone:     '',
    location:  '',
    linkedin:  '',
    portfolio: '',
    title:     ''   /* job title / target role shown under the name */
  },
  summary: '',
  skills: {
    technical: '',
    soft:      '',
    tools:     '',
    languages: ''
  },
  education:      [],  /* each item: { id, degree, institution, year, grade }        */
  experience:     [],  /* each item: { id, company, role, duration, location, description } */
  internships:    [],  /* same shape as experience                                   */
  projects:       [],  /* each item: { id, name, tech, role, duration, link, description } */
  certifications: []   /* each item: { id, title, issuer, year, link }               */
};

/* Tracks which section tab is currently visible in the editor */
let currentSection = 'personal';


/* ════════════════════════════════════════════════════════════
   2. SECTION DEFINITIONS
   WHY: A single array drives both the tab buttons and the
        section renderers. To add a new section, add one item
        here — you don't have to touch the tab-rendering code.

   id    → key used in state{} and sectionRenderers{}
   label → display text on the tab button
════════════════════════════════════════════════════════════ */
const SECTIONS = [
  { id: 'personal',       label: 'Personal'    },
  { id: 'summary',        label: 'Summary'     },
  { id: 'skills',         label: 'Skills'      },
  { id: 'education',      label: 'Education'   },
  { id: 'experience',     label: 'Experience'  },
  { id: 'internship',     label: 'Internship'  },
  { id: 'projects',       label: 'Projects'    },
  { id: 'certifications', label: 'Certs'       },
];


/* ════════════════════════════════════════════════════════════
   3. AUTO-SAVE WITH localStorage
   WHY: Without this, refreshing the page loses all data.
        localStorage persists key-value strings in the browser
        with no expiry date.

   saveToStorage() → serialises state to JSON and saves it
   loadFromStorage()→ reads saved JSON and merges it into state
   Both are called automatically; the user never needs to click Save.
════════════════════════════════════════════════════════════ */
const STORAGE_KEY = 'resumeBuilderData_v1';
/* The _v1 suffix is important — if you change the state structure
   in a future version, bump to _v2 so old incompatible data is ignored. */

/**
 * Saves the entire state object to localStorage as a JSON string.
 * Called after every field change (triggered inside renderPreview).
 */
function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    /* Show the auto-save badge briefly */
    const badge = document.getElementById('autosave-badge');
    if (badge) {
      badge.classList.add('visible');
      clearTimeout(badge._timer);
      badge._timer = setTimeout(() => badge.classList.remove('visible'), 1800);
    }
  } catch (e) {
    /* localStorage can fail in private/incognito mode — fail silently */
    console.warn('Auto-save failed:', e);
  }
}

/**
 * Reads saved data from localStorage and merges it into the live state.
 * Called once on page load (see Initialisation section at the bottom).
 * Uses Object.assign so that any NEW fields added to state{} in a future
 * code update won't be overwritten by old saved data.
 */
function loadFromStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return; /* nothing saved yet — first visit */

    const parsed = JSON.parse(saved);

    /* Merge each section carefully so we don't accidentally overwrite
       new state fields with undefined values from old saved data */
    if (parsed.personal)  Object.assign(state.personal, parsed.personal);
    if (parsed.skills)    Object.assign(state.skills,   parsed.skills);
    if (typeof parsed.summary === 'string') state.summary = parsed.summary;

    /* For arrays, replace the whole array if valid */
    if (Array.isArray(parsed.education))      state.education      = parsed.education;
    if (Array.isArray(parsed.experience))     state.experience     = parsed.experience;
    if (Array.isArray(parsed.internships))    state.internships    = parsed.internships;
    if (Array.isArray(parsed.projects))       state.projects       = parsed.projects;
    if (Array.isArray(parsed.certifications)) state.certifications = parsed.certifications;
  } catch (e) {
    console.warn('Failed to load saved data:', e);
  }
}

/**
 * Clears all saved data and resets state to empty.
 * Called by the "Reset" button rendered in the Personal section.
 */
function clearAllData() {
  if (!confirm('Reset all data? This cannot be undone.')) return;
  localStorage.removeItem(STORAGE_KEY);
  /* Reset every field manually */
  Object.keys(state.personal).forEach(k => state.personal[k] = '');
  Object.keys(state.skills).forEach(k => state.skills[k] = '');
  state.summary = '';
  state.education      = [];
  state.experience     = [];
  state.internships    = [];
  state.projects       = [];
  state.certifications = [];
  renderSection();
  renderPreview();
  showToast('All data cleared.');
}


/* ════════════════════════════════════════════════════════════
   4. TAB RENDERING
   WHY: The tabs are built dynamically from the SECTIONS array
        so we don't hard-code HTML for each tab. Adding a new
        section to SECTIONS automatically creates its tab.
════════════════════════════════════════════════════════════ */

/**
 * Renders the tab button row above the editor form.
 * Marks the currently active tab with the .active class.
 */
function renderTabs() {
  document.getElementById('tabs').innerHTML = SECTIONS.map(s => `
    <button
      class="tab${s.id === currentSection ? ' active' : ''}"
      onclick="switchSection('${s.id}')"
      role="tab"
      aria-selected="${s.id === currentSection}"
      aria-controls="section-content"
    >${s.label}</button>
  `).join('');
}

/**
 * Switches the active section, then re-renders tabs and the form.
 * @param {string} id - The section id from SECTIONS array
 */
function switchSection(id) {
  currentSection = id;
  renderTabs();
  renderSection();
}


/* ════════════════════════════════════════════════════════════
   5. FIELD UPDATE HELPERS
   WHY: Each type of field needs a slightly different path
        to update the state object. These helpers centralise
        that logic so it doesn't get repeated inside every
        oninput handler.
════════════════════════════════════════════════════════════ */

/**
 * Updates a field inside state.personal or state.skills (flat objects).
 * @param {'personal'|'skills'} stateKey - which sub-object to update
 * @param {string} field   - the property name (e.g. 'name', 'email')
 * @param {string} val     - the new value from the input
 */
function setField(stateKey, field, val) {
  state[stateKey][field] = val;
  renderPreview();
}

/**
 * Updates the top-level summary string.
 * @param {string} val - the new summary text
 */
function setTopField(val) {
  state.summary = val;
  renderPreview();
}

/**
 * Updates a field inside a specific array entry (education, experience, etc.)
 * FIXED: arrKey is now passed in explicitly instead of reading currentSection,
 *        which prevents the bug where the wrong array gets updated.
 * @param {string} arrKey - state array to update (e.g. 'education', 'projects')
 * @param {string} id     - the unique id of the entry to update
 * @param {string} field  - the property name to update (e.g. 'degree', 'company')
 * @param {string} val    - the new value from the input
 */
function setEntryField(arrKey, id, field, val) {
  const item = state[arrKey].find(x => x.id === id);
  if (item) {
    item[field] = val;
    renderPreview();
  }
}


/* ════════════════════════════════════════════════════════════
   6. SECTION RENDERERS
   WHY: Each section has a completely different form layout.
        Instead of switching visibility on pre-rendered HTML,
        we replace the content entirely. This keeps the DOM
        clean and makes each section independent.

   sectionRenderers is an object where each key is a section id
   and the value is a function that returns an HTML string.
   renderSection() calls the matching function and injects it.
════════════════════════════════════════════════════════════ */
const sectionRenderers = {

  /* ── PERSONAL DETAILS ────────────────────────────────── */
  personal() {
    const p = state.personal;
    return `
      <div class="section-title">
        Personal Details
        <span id="autosave-badge" class="autosave-badge">✓ Saved</span>
      </div>

      <div class="form-grid">
        ${fieldInput('Full Name',           'name',      p, 'Suchismita Padhi',        'personal')}
        ${fieldInput('Job Title / Target Role', 'title', p, 'Software Developer',      'personal')}
        ${fieldInput('Email',               'email',     p, 'you@email.com',           'personal')}
        ${fieldInput('Phone',               'phone',     p, '+91 9XXXXXXXXX',          'personal')}
        ${fieldInput('Location',            'location',  p, 'Bhubaneswar, Odisha',     'personal')}
        ${fieldInput('LinkedIn URL',        'linkedin',  p, 'linkedin.com/in/...',     'personal')}
        <div class="form-group span2">
          <label>Portfolio / GitHub</label>
          <input
            value="${esc(p.portfolio)}"
            placeholder="github.com/..."
            oninput="setField('personal','portfolio',this.value)"
          />
        </div>
      </div>

      <!-- Reset button — clears all data after confirmation -->
      <button
        onclick="clearAllData()"
        style="margin-top:16px;color:var(--danger);background:transparent;border:1px solid rgba(255,107,107,.3);font-size:12px;padding:6px 12px"
      >🗑 Reset All Data</button>
    `;
  },

  /* ── PROFESSIONAL SUMMARY ────────────────────────────── */
  summary() {
    return `
      <div class="section-title">
        Professional Summary
        <span>2–3 impactful lines</span>
      </div>

      <!-- Multi-line textarea for the summary paragraph -->
      <textarea
        rows="5"
        placeholder="A results-driven MCA student with experience in..."
        oninput="setTopField(this.value)"
      >${esc(state.summary)}</textarea>

      <!--
        AI Generate Button
        Clicking this calls generateAISummary() which sends the user's
        personal details and skills to the Claude API and fills in
        a professional summary automatically.
      -->
      <button
        class="ai-btn"
        id="ai-summary-btn"
        onclick="generateAISummary()"
      >✨ Generate Summary with AI</button>

      <!-- Status text shown while the AI is generating -->
      <p id="ai-status" style="font-size:12px;color:var(--muted);margin-top:8px;display:none">
        Generating...
      </p>
    `;
  },

  /* ── SKILLS ──────────────────────────────────────────── */
  skills() {
    const sk = state.skills;
    return `
      <div class="section-title">Skills <span>comma-separated values</span></div>

      <div class="form-grid full">
        ${fieldInput('Technical Skills', 'technical', sk, 'Java, Python, React, Spring Boot, MySQL...', 'skills')}
        ${fieldInput('Tools & Technologies', 'tools', sk, 'VS Code, Git, Docker, Postman, Maven...',    'skills')}
        ${fieldInput('Soft Skills',       'soft',     sk, 'Leadership, Communication, Problem Solving...','skills')}
        ${fieldInput('Languages',         'languages',sk, 'English, Odia, Hindi',                      'skills')}
      </div>
    `;
  },

  /* ── EDUCATION ───────────────────────────────────────── */
  education() {
    return entrySection(
      'education',
      'Education',
      /* field labels   */ ['Degree / Program', 'Institution', 'Year', 'Grade / CGPA'],
      /* state keys     */ ['degree', 'institution', 'year', 'grade'],
      /* placeholders   */ ['MCA', 'GIFT Autonomous, Bhubaneswar', '2025–2027', '8.5 CGPA']
    );
  },

  /* ── WORK EXPERIENCE ─────────────────────────────────── */
  experience() {
    return expSection('experience', 'Work Experience');
  },

  /* ── INTERNSHIPS ─────────────────────────────────────── */
  internship() {
    return expSection('internships', 'Internships');
  },

  /* ── PROJECTS ────────────────────────────────────────── */
  projects() {
    return `
      <div class="section-title">Projects</div>

      ${state.projects.map(p => `
        <div class="entry-card">
          <div class="entry-card-header">
            <span class="entry-card-label">Project</span>
            <button class="danger" onclick="removeEntry('projects','${p.id}')">✕ Remove</button>
          </div>
          <div class="form-grid">
            <div class="form-group">
              <label>Project Name</label>
              <input value="${esc(p.name)}" placeholder="Train Ticket Reservation System"
                oninput="setEntryField('projects','${p.id}','name',this.value)"/>
            </div>
            <div class="form-group">
              <label>Tech Stack</label>
              <input value="${esc(p.tech)}" placeholder="Spring Boot, MySQL, Thymeleaf"
                oninput="setEntryField('projects','${p.id}','tech',this.value)"/>
            </div>
            <div class="form-group">
              <label>Your Role</label>
              <input value="${esc(p.role)}" placeholder="Backend Developer"
                oninput="setEntryField('projects','${p.id}','role',this.value)"/>
            </div>
            <div class="form-group">
              <label>Duration</label>
              <input value="${esc(p.duration)}" placeholder="Jan 2024 – Mar 2024"
                oninput="setEntryField('projects','${p.id}','duration',this.value)"/>
            </div>
            <div class="form-group span2">
              <label>GitHub / Live Link</label>
              <input value="${esc(p.link)}" placeholder="github.com/..."
                oninput="setEntryField('projects','${p.id}','link',this.value)"/>
            </div>
            <div class="form-group span2">
              <label>Description</label>
              <textarea rows="3"
                oninput="setEntryField('projects','${p.id}','description',this.value)"
                placeholder="Built a full-stack web app using..."
              >${esc(p.description)}</textarea>
            </div>
          </div>
        </div>
      `).join('')}

      <button class="add-btn"
        onclick="addEntry('projects',{name:'',tech:'',role:'',duration:'',link:'',description:''})">
        + Add Project
      </button>
    `;
  },

  /* ── CERTIFICATIONS ──────────────────────────────────── */
  certifications() {
    return `
      <div class="section-title">Certifications & Achievements</div>

      ${state.certifications.map(c => `
        <div class="entry-card">
          <div class="entry-card-header">
            <span class="entry-card-label">Certificate</span>
            <button class="danger" onclick="removeEntry('certifications','${c.id}')">✕ Remove</button>
          </div>
          <div class="form-grid">
            <div class="form-group">
              <label>Certificate Title</label>
              <input value="${esc(c.title)}" placeholder="IBM SkillsBuild AI Internship"
                oninput="setEntryField('certifications','${c.id}','title',this.value)"/>
            </div>
            <div class="form-group">
              <label>Issuing Organisation</label>
              <input value="${esc(c.issuer)}" placeholder="Coursera / NPTEL / Anthropic"
                oninput="setEntryField('certifications','${c.id}','issuer',this.value)"/>
            </div>
            <div class="form-group">
              <label>Year</label>
              <input value="${esc(c.year)}" placeholder="2024"
                oninput="setEntryField('certifications','${c.id}','year',this.value)"/>
            </div>
            <div class="form-group">
              <label>Verify Link / ID</label>
              <input value="${esc(c.link)}" placeholder="verify.credly.com/..."
                oninput="setEntryField('certifications','${c.id}','link',this.value)"/>
            </div>
          </div>
        </div>
      `).join('')}

      <button class="add-btn"
        onclick="addEntry('certifications',{title:'',issuer:'',year:'',link:''})">
        + Add Certification
      </button>
    `;
  }
};

/**
 * Injects the current section's HTML into #section-content.
 * Called by switchSection() and whenever entries are added/removed.
 */
function renderSection() {
  const renderer = sectionRenderers[currentSection];
  document.getElementById('section-content').innerHTML = renderer ? renderer() : '';
}


/* ════════════════════════════════════════════════════════════
   7. FIELD GENERATOR HELPERS
   WHY: Building input HTML is repetitive. These small functions
        reduce repetition and keep section renderers readable.

   fieldInput(label, key, obj, placeholder, stateKey)
     → renders a <div class="form-group"> with label + input
     → works for both 'personal' and 'skills' sub-objects

   entrySection(arrKey, title, labels, fields, placeholders)
     → renders a list of simple-field entry cards (e.g. Education)

   expSection(arrKey, title)
     → renders a list of experience/internship entry cards
════════════════════════════════════════════════════════════ */

/**
 * Escapes HTML special characters to prevent XSS.
 * WHY: User-typed content is injected into innerHTML.
 *      Without escaping, a user could type <script> and break the app.
 * @param {string} s - raw string
 * @returns {string} safely escaped string
 */
function esc(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Unique ID counter for entry objects.
 * WHY: Each entry (education, project etc.) needs a stable unique id
 *      so setEntryField() can find the right item in the array.
 *      Simple incrementing counter is fine here — not cryptographic.
 */
let idCounter = 0;
const uid = () => 'id' + (++idCounter);

/**
 * Renders a single <div class="form-group"> for a flat-object field.
 * @param {string} label       - display label text
 * @param {string} key         - property name in obj
 * @param {object} obj         - the state sub-object (personal or skills)
 * @param {string} placeholder - input placeholder text
 * @param {string} stateKey    - 'personal' or 'skills' (for setField call)
 * @returns {string} HTML string
 */
function fieldInput(label, key, obj, placeholder, stateKey) {
  return `
    <div class="form-group">
      <label>${label}</label>
      <input
        value="${esc(obj[key] || '')}"
        placeholder="${placeholder}"
        oninput="setField('${stateKey}','${key}',this.value)"
      />
    </div>
  `;
}

/**
 * Renders a full section of simple repeated entries (e.g. Education).
 * Each entry shows a card with a fixed set of text fields.
 * @param {string}   arrKey       - state array key (e.g. 'education')
 * @param {string}   title        - section display title
 * @param {string[]} labels       - array of field label strings
 * @param {string[]} fields       - array of state property names (must match labels)
 * @param {string[]} placeholders - array of placeholder strings (must match labels)
 * @returns {string} HTML string
 */
function entrySection(arrKey, title, labels, fields, placeholders) {
  const arr = state[arrKey];
  return `
    <div class="section-title">${title}</div>

    ${arr.map(entry => `
      <div class="entry-card">
        <div class="entry-card-header">
          <span class="entry-card-label">${title} Entry</span>
          <button class="danger" onclick="removeEntry('${arrKey}','${entry.id}')">✕ Remove</button>
        </div>
        <div class="form-grid">
          ${fields.map((field, i) => `
            <div class="form-group">
              <label>${labels[i]}</label>
              <input
                value="${esc(entry[field] || '')}"
                placeholder="${placeholders[i]}"
                oninput="setEntryField('${arrKey}','${entry.id}','${field}',this.value)"
              />
            </div>
          `).join('')}
        </div>
      </div>
    `).join('')}

    <button class="add-btn"
      onclick="addEntry('${arrKey}', {${fields.map(f => `'${f}':''`).join(',')}})">
      + Add ${title}
    </button>
  `;
}

/**
 * Renders an experience or internship section.
 * WHY: These have a specific consistent layout (company, role, duration,
 *      location, description) that doesn't fit the generic entrySection.
 * @param {string} arrKey - 'experience' or 'internships'
 * @param {string} title  - display title
 * @returns {string} HTML string
 */
function expSection(arrKey, title) {
  const arr = state[arrKey];
  return `
    <div class="section-title">${title}</div>

    ${arr.map(entry => `
      <div class="entry-card">
        <div class="entry-card-header">
          <span class="entry-card-label">${title} Entry</span>
          <button class="danger" onclick="removeEntry('${arrKey}','${entry.id}')">✕ Remove</button>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label>Company / Organisation</label>
            <input value="${esc(entry.company)}" placeholder="Tech Corp"
              oninput="setEntryField('${arrKey}','${entry.id}','company',this.value)"/>
          </div>
          <div class="form-group">
            <label>Role / Position</label>
            <input value="${esc(entry.role)}" placeholder="Software Engineer"
              oninput="setEntryField('${arrKey}','${entry.id}','role',this.value)"/>
          </div>
          <div class="form-group">
            <label>Duration</label>
            <input value="${esc(entry.duration)}" placeholder="Jun 2024 – Present"
              oninput="setEntryField('${arrKey}','${entry.id}','duration',this.value)"/>
          </div>
          <div class="form-group">
            <label>Location</label>
            <input value="${esc(entry.location)}" placeholder="Bhubaneswar / Remote"
              oninput="setEntryField('${arrKey}','${entry.id}','location',this.value)"/>
          </div>
          <div class="form-group span2">
            <label>Description / Bullet Points</label>
            <textarea rows="4"
              oninput="setEntryField('${arrKey}','${entry.id}','description',this.value)"
              placeholder="• Led development of...&#10;• Improved performance by..."
            >${esc(entry.description)}</textarea>
          </div>
        </div>
      </div>
    `).join('')}

    <button class="add-btn"
      onclick="addEntry('${arrKey}',{company:'',role:'',duration:'',location:'',description:''})">
      + Add ${title}
    </button>
  `;
}


/* ════════════════════════════════════════════════════════════
   8. ENTRY MANAGEMENT
   WHY: Education, experience, projects etc. are dynamic lists.
        addEntry() creates a new empty object with a unique id
        and pushes it to the right array.
        removeEntry() filters it out by id.
        Both re-render the section and preview after the change.
════════════════════════════════════════════════════════════ */

/**
 * Adds a new blank entry to a state array and re-renders.
 * @param {string} arrKey   - state array to push to (e.g. 'education')
 * @param {object} defaults - object with default empty values for each field
 */
function addEntry(arrKey, defaults) {
  state[arrKey].push({ id: uid(), ...defaults });
  renderSection();
  renderPreview();
}

/**
 * Removes an entry from a state array by its unique id and re-renders.
 * @param {string} arrKey - state array to remove from
 * @param {string} id     - id of the entry to remove
 */
function removeEntry(arrKey, id) {
  state[arrKey] = state[arrKey].filter(x => x.id !== id);
  renderSection();
  renderPreview();
}


/* ════════════════════════════════════════════════════════════
   9. RESUME PREVIEW RENDERER
   WHY: This is the core of the app. Every time a user types
        anything, this function runs and rebuilds the entire
        resume HTML from the current state object.

   It also calls saveToStorage() to auto-save the data.

   STRUCTURE OF THE RENDERED RESUME:
     Header (name, title, contact)
     → Summary
     → Education
     → Work Experience
     → Internships
     → Projects
     → Skills
     → Certifications
════════════════════════════════════════════════════════════ */

/**
 * Builds a resume section block.
 * Returns empty string if html is empty/falsy (section not filled in yet).
 * @param {string} title - section heading (e.g. "EDUCATION")
 * @param {string} html  - inner HTML content
 * @returns {string}
 */
function resumeSection(title, html) {
  if (!html || !html.trim()) return '';
  return `<div class="r-section-title">${title}</div>${html}`;
}

/**
 * Renders experience / internship entries for the resume preview.
 * @param {Array} arr - array of experience/internship objects
 * @returns {string} HTML string
 */
function renderExpHtml(arr) {
  return arr.map(e => `
    <div class="r-entry">
      <div class="r-entry-head">
        <span class="r-entry-title">${esc(e.role)}${e.company ? ' — ' + esc(e.company) : ''}</span>
        <span class="r-entry-date">${esc(e.duration)}</span>
      </div>
      ${e.location ? `<div class="r-entry-sub">${esc(e.location)}</div>` : ''}
      ${e.description ? `<div class="r-entry-desc">${esc(e.description)}</div>` : ''}
    </div>
  `).join('');
}

/**
 * Rebuilds the entire resume preview and injects it into #resume-sheet.
 * Also triggers auto-save.
 */
function renderPreview() {
  const { personal: p, summary, skills, education, experience, internships, projects, certifications } = state;

  /* Contact line — only include fields that have values */
  const contactItems = [p.email, p.phone, p.location, p.linkedin, p.portfolio]
    .filter(Boolean)
    .map(x => `<span>${esc(x)}</span>`)
    .join('');

  /* Education entries */
  const eduHtml = education.map(e => `
    <div class="r-entry">
      <div class="r-entry-head">
        <span class="r-entry-title">${esc(e.degree)}</span>
        <span class="r-entry-date">${esc(e.year)}</span>
      </div>
      <div class="r-entry-sub">
        ${esc(e.institution)}${e.grade ? ' | ' + esc(e.grade) : ''}
      </div>
    </div>
  `).join('');

  /* Project entries */
  const projHtml = projects.map(pr => `
    <div class="r-entry">
      <div class="r-entry-head">
        <span class="r-entry-title">${esc(pr.name)}</span>
        <span class="r-entry-date" style="font-size:11px">${esc(pr.duration)}</span>
      </div>
      <div class="r-entry-sub">
        ${[pr.tech && 'Tech: ' + pr.tech, pr.link].filter(Boolean).map(esc).join(' | ')}
      </div>
      ${pr.description ? `<div class="r-entry-desc">${esc(pr.description)}</div>` : ''}
    </div>
  `).join('');

  /* Certification entries */
  const certHtml = certifications.map(c => `
    <div class="r-cert-row">
      <span>
        <span class="r-cert-title">${esc(c.title)}</span>
        ${c.issuer ? ' — ' + esc(c.issuer) : ''}
      </span>
      <span class="r-cert-year">${esc(c.year)}</span>
    </div>
  `).join('');

  /* Skills block — only render rows that have data */
  const skillsHtml = (skills.technical || skills.tools || skills.soft || skills.languages)
    ? `<div class="r-skills-grid">
        ${skills.technical ? `<div class="r-skill-row"><span class="r-skill-label">Technical:</span><span class="r-skill-val">${esc(skills.technical)}</span></div>` : ''}
        ${skills.tools     ? `<div class="r-skill-row"><span class="r-skill-label">Tools:</span><span class="r-skill-val">${esc(skills.tools)}</span></div>` : ''}
        ${skills.soft      ? `<div class="r-skill-row"><span class="r-skill-label">Soft Skills:</span><span class="r-skill-val">${esc(skills.soft)}</span></div>` : ''}
        ${skills.languages ? `<div class="r-skill-row"><span class="r-skill-label">Languages:</span><span class="r-skill-val">${esc(skills.languages)}</span></div>` : ''}
       </div>`
    : '';

  /* Assemble the full resume HTML */
  document.getElementById('resume-sheet').innerHTML = `
    <div class="r-header">
      <div class="r-name">${esc(p.name) || 'Your Name'}</div>
      ${p.title ? `<div class="r-title">${esc(p.title)}</div>` : ''}
      <div class="r-contact">${contactItems}</div>
    </div>

    ${summary
      ? resumeSection('Professional Summary',
          `<p style="font-size:12.5px;color:#333;margin-bottom:4px">${esc(summary)}</p>`)
      : ''}
    ${resumeSection('Education',                  eduHtml)}
    ${resumeSection('Work Experience',             renderExpHtml(experience))}
    ${resumeSection('Internships',                 renderExpHtml(internships))}
    ${resumeSection('Projects',                    projHtml)}
    ${resumeSection('Skills',                      skillsHtml)}
    ${resumeSection('Certifications & Achievements', certHtml)}
  `;

  /* Auto-save after every render */
  saveToStorage();
}


/* ════════════════════════════════════════════════════════════
   10. VIEW TOGGLE
   WHY: On desktop we show both panels side by side (split).
        But sometimes the user wants to focus on just editing
        or just previewing. CSS classes handle the layout change.
════════════════════════════════════════════════════════════ */

/**
 * Switches the main layout between split / editor-only / preview-only.
 * @param {'split'|'editor'|'preview'} v - the view mode to activate
 */
function setView(v) {
  const layout = document.getElementById('main-layout');

  /* Remove all modifier classes first */
  layout.className = 'layout';

  /* Add the appropriate modifier class */
  if (v === 'editor')  layout.classList.add('editor-only');
  if (v === 'preview') layout.classList.add('preview-only');

  /* Update the active state on the view toggle buttons in the topbar */
  document.querySelectorAll('.view-btn').forEach((btn, i) => {
    const views = ['split', 'editor', 'preview'];
    btn.classList.toggle('active', views[i] === v);
  });
}


/* ════════════════════════════════════════════════════════════
   11. DOWNLOAD FUNCTION
   WHY: The browser's built-in print dialog can save as PDF.
        We open a new window with just the resume HTML + CSS,
        then trigger window.print() after the fonts load (600ms delay).

   IMPORTANT: If you change the resume CSS in style.css,
        update RESUME_PRINT_CSS here too — they are separate
        and must stay in sync.
════════════════════════════════════════════════════════════ */

/* Shared CSS for the printable resume.
   This is a constant so it's defined once and used in downloadResume(). */
const RESUME_PRINT_CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: 'DM Sans', sans-serif;
    font-size: 12.5px;
    line-height: 1.6;
    color: #1a1a1a;
    padding: 36px 40px;
    max-width: 780px;
    margin: auto;
  }
  .r-header { text-align:center; padding-bottom:14px; margin-bottom:14px; border-bottom:2.5px solid #1a1a1a; }
  .r-name { font-family:'DM Serif Display',serif; font-size:26px; letter-spacing:.5px; color:#111; margin-bottom:5px; }
  .r-title { font-size:13px; color:#555; margin-bottom:5px; }
  .r-contact { display:flex; flex-wrap:wrap; justify-content:center; gap:4px 16px; font-size:11.5px; color:#555; }
  .r-section-title { font-size:11px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#111; border-bottom:1.5px solid #111; padding-bottom:3px; margin:14px 0 8px; }
  .r-entry { margin-bottom:8px; }
  .r-entry-head { display:flex; justify-content:space-between; align-items:baseline; }
  .r-entry-title { font-weight:600; font-size:13px; }
  .r-entry-sub { font-size:12px; color:#555; margin-bottom:3px; }
  .r-entry-date { font-size:11.5px; color:#555; white-space:nowrap; margin-left:10px; flex-shrink:0; }
  .r-entry-desc { font-size:12px; color:#333; white-space:pre-wrap; margin-top:3px; }
  .r-skills-grid { display:flex; flex-direction:column; gap:4px; }
  .r-skill-row { display:flex; gap:6px; align-items:baseline; font-size:12px; }
  .r-skill-label { font-weight:600; min-width:110px; color:#333; flex-shrink:0; }
  .r-skill-val { color:#444; }
  .r-cert-row { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px; font-size:12px; }
  .r-cert-title { font-weight:600; }
  .r-cert-year { font-size:11px; color:#666; }
  @media print { @page { margin: 0; size: A4; } body { padding: 36px 40px; } }
`;

/**
 * Opens a new browser tab with the resume HTML and triggers print/save-as-PDF.
 */
function downloadResume() {
  const resumeContent = document.getElementById('resume-sheet').innerHTML;
  const candidateName = state.personal.name || 'Resume';

  const printableHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8"/>
      <title>Resume – ${esc(candidateName)}</title>
      <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
      <style>${RESUME_PRINT_CSS}</style>
    </head>
    <body>${resumeContent}</body>
    </html>
  `;

  const printWindow = window.open('', '_blank');
  printWindow.document.write(printableHTML);
  printWindow.document.close();

  /* 600ms delay allows Google Fonts to load before printing */
  setTimeout(() => { printWindow.print(); }, 600);
}


/* ════════════════════════════════════════════════════════════
   12. TOAST NOTIFICATION
   WHY: Gives the user brief feedback (e.g. "Summary generated!")
        without a disruptive alert popup or modal.
════════════════════════════════════════════════════════════ */

/**
 * Shows a brief toast message at the bottom-right of the screen.
 * @param {string} msg - the message to display
 * @param {number} duration - milliseconds to show it (default 2800)
 */
function showToast(msg, duration = 2800) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, duration);
}


/* ════════════════════════════════════════════════════════════
   13. AI SUMMARY GENERATOR
   WHY: Writing a professional summary is the hardest part
        of a resume. This feature sends the user's filled-in
        data to the Claude API and gets back a polished 2-3
        line summary, which is then auto-filled into the textarea.

   HOW IT WORKS:
     1. Reads current personal + skills + experience data from state
     2. Builds a prompt describing the candidate
     3. Calls the Anthropic messages API (Claude Sonnet)
     4. Extracts the text response
     5. Injects it into state.summary and re-renders

   NOTE: This uses the built-in API access available in
         Claude Artifacts — no API key needed in the code.
════════════════════════════════════════════════════════════ */

/**
 * Calls the Claude API to generate a professional resume summary
 * based on the user's current input data.
 */
async function generateAISummary() {
  const btn    = document.getElementById('ai-summary-btn');
  const status = document.getElementById('ai-status');

  /* Collect available data to give the AI context */
  const { personal: p, skills, experience, internships, education } = state;

  /* Build a descriptive prompt from the user's filled-in data */
  const prompt = `
Write a professional resume summary (2-3 sentences, first person, no clichés) for a candidate with the following details:

Name: ${p.name || 'not provided'}
Target Role: ${p.title || 'not provided'}
Technical Skills: ${skills.technical || 'not provided'}
Tools: ${skills.tools || 'not provided'}
Education: ${education.map(e => `${e.degree} from ${e.institution} (${e.year})`).join(', ') || 'not provided'}
Experience: ${[...experience, ...internships].map(e => `${e.role} at ${e.company}`).join(', ') || 'not provided'}

Rules:
- Max 3 sentences
- Start with the person's background/role
- Mention 2-3 key technical strengths
- End with value they bring to employers
- Do NOT use phrases like "results-driven", "passionate", "dynamic", "seasoned"
- Return ONLY the summary text, no quotes, no labels
  `.trim();

  /* Disable button and show loading state */
  btn.disabled = true;
  btn.textContent = '⏳ Generating...';
  status.style.display = 'block';

  try {
    /* Call the Claude API */
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    /* Extract the text from the response content array */
    const generatedSummary = data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim();

    if (!generatedSummary) throw new Error('Empty response from API');

    /* Update state and re-render */
    state.summary = generatedSummary;
    renderPreview();

    /* Update the textarea directly (since renderSection only updates on tab switch) */
    const textarea = document.querySelector('#section-content textarea');
    if (textarea) textarea.value = generatedSummary;

    showToast('✨ Summary generated!');

  } catch (err) {
    console.error('AI generation failed:', err);
    showToast('Generation failed. Please try again.', 4000);
  } finally {
    /* Always restore button state */
    btn.disabled = false;
    btn.textContent = '✨ Generate Summary with AI';
    status.style.display = 'none';
  }
}


/* ════════════════════════════════════════════════════════════
   14. INITIALISATION
   WHY: These three lines run when the page first loads.
        Order matters:
          1. Load saved data from localStorage into state
          2. Render the tab buttons
          3. Render the Personal section form
          4. Render the live resume preview with loaded data
════════════════════════════════════════════════════════════ */
loadFromStorage();  /* 1. Restore any previously saved data */
renderTabs();       /* 2. Build the section tab buttons     */
renderSection();    /* 3. Show the Personal form by default */
renderPreview();    /* 4. Populate the live preview         */