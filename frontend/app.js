/**
 * Vote System - Frontend Application
 * Module structure for API integration
 */

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  API_BASE_URL: '/api',
  STORAGE_KEYS: {
    TOKEN: 'vote_system_token',
    USER: 'vote_system_user',
  },
};

// =============================================================================
// State Management
// =============================================================================

const state = {
  user: null,
  token: null,
  polls: [],
  currentPoll: null,
  currentSection: 'poll-dashboard',
};

// =============================================================================
// API Module
// =============================================================================

const api = {
  /**
   * Make an API request
   * @param {string} endpoint - API endpoint (e.g., '/polls')
   * @param {object} options - Fetch options
   * @returns {Promise<any>}
   */
  async request(endpoint, options = {}) {
    const url = `${CONFIG.API_BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add auth token if available
    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  },

  // Poll endpoints
  polls: {
    async list() {
      return api.request('/polls');
    },

    async get(id) {
      return api.request(`/polls/${id}`);
    },

    async create(pollData) {
      return api.request('/polls', {
        method: 'POST',
        body: JSON.stringify(pollData),
      });
    },

    async vote(pollId, optionId, fingerprint) {
      return api.request(`/polls/${pollId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ option_id: optionId, fingerprint }),
      });
    },
  },

  // Auth endpoints
  auth: {
    async register(email, password) {
      return api.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
    },

    async login(email, password) {
      return api.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
    },
  },
};

// =============================================================================
// Storage Module
// =============================================================================

const storage = {
  get(key) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch {
      return null;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      console.error('Failed to save to localStorage');
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      console.error('Failed to remove from localStorage');
    }
  },

  // Auth-specific helpers
  getToken() {
    return this.get(CONFIG.STORAGE_KEYS.TOKEN);
  },

  setToken(token) {
    this.set(CONFIG.STORAGE_KEYS.TOKEN, token);
  },

  getUser() {
    return this.get(CONFIG.STORAGE_KEYS.USER);
  },

  setUser(user) {
    this.set(CONFIG.STORAGE_KEYS.USER, user);
  },

  clearAuth() {
    this.remove(CONFIG.STORAGE_KEYS.TOKEN);
    this.remove(CONFIG.STORAGE_KEYS.USER);
  },
};

// =============================================================================
// UI Module
// =============================================================================

const ui = {
  // Element selectors cache
  elements: {},

  /**
   * Get element by ID with caching
   * @param {string} id - Element ID
   * @returns {HTMLElement|null}
   */
  $(id) {
    if (!this.elements[id]) {
      this.elements[id] = document.getElementById(id);
    }
    return this.elements[id];
  },

  /**
   * Show a section and hide others
   * @param {string} sectionId - Section ID to show
   */
  showSection(sectionId) {
    const sections = [
      'poll-dashboard',
      'poll-view',
      'login-section',
      'register-section',
      'create-poll-section',
    ];

    sections.forEach((id) => {
      const section = this.$(id);
      if (section) {
        section.classList.toggle('hidden', id !== sectionId);
      }
    });

    state.currentSection = sectionId;
  },

  /**
   * Update navigation based on auth state
   */
  updateNav() {
    const authNav = this.$('auth-nav');
    const userNav = this.$('user-nav');
    const userEmail = this.$('user-email');

    if (state.user) {
      authNav.classList.add('hidden');
      userNav.classList.remove('hidden');
      userEmail.textContent = state.user.email;
    } else {
      authNav.classList.remove('hidden');
      userNav.classList.add('hidden');
      userEmail.textContent = '';
    }
  },

  /**
   * Show loading state for a container
   * @param {string} containerId - Container element ID
   */
  showLoading(containerId) {
    const loading = this.$(`${containerId}-loading`);
    const content = this.$(containerId);
    const empty = this.$(`${containerId}-empty`);
    const error = this.$(`${containerId}-error`);

    if (loading) loading.classList.remove('hidden');
    if (content) content.classList.add('hidden');
    if (empty) empty.classList.add('hidden');
    if (error) error.classList.add('hidden');
  },

  /**
   * Hide loading state and show content
   * @param {string} containerId - Container element ID
   */
  hideLoading(containerId) {
    const loading = this.$(`${containerId}-loading`);
    if (loading) loading.classList.add('hidden');
  },

  /**
   * Show error state
   * @param {string} containerId - Container element ID
   */
  showError(containerId) {
    const loading = this.$(`${containerId}-loading`);
    const error = this.$(`${containerId}-error`);

    if (loading) loading.classList.add('hidden');
    if (error) error.classList.remove('hidden');
  },

  /**
   * Show empty state
   * @param {string} containerId - Container element ID
   */
  showEmpty(containerId) {
    const loading = this.$(`${containerId}-loading`);
    const empty = this.$(`${containerId}-empty`);

    if (loading) loading.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
  },

  /**
   * Set form loading state
   * @param {HTMLFormElement} form - Form element
   * @param {boolean} isLoading - Loading state
   */
  setFormLoading(form, isLoading) {
    const submitBtn = form.querySelector('button[type="submit"]');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoading = submitBtn.querySelector('.btn-loading');

    submitBtn.disabled = isLoading;
    if (btnText) btnText.classList.toggle('hidden', isLoading);
    if (btnLoading) btnLoading.classList.toggle('hidden', !isLoading);

    // Disable all inputs
    form.querySelectorAll('input, textarea, button').forEach((el) => {
      el.disabled = isLoading;
    });
  },

  /**
   * Show form error message
   * @param {string} formId - Form ID prefix
   * @param {string} message - Error message
   */
  showFormError(formId, message) {
    const errorEl = this.$(`${formId}-error`);
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
  },

  /**
   * Hide form error message
   * @param {string} formId - Form ID prefix
   */
  hideFormError(formId) {
    const errorEl = this.$(`${formId}-error`);
    if (errorEl) {
      errorEl.classList.add('hidden');
    }
  },
};

// =============================================================================
// Toast Notifications Module
// =============================================================================

const toast = {
  container: null,

  init() {
    this.container = document.getElementById('toast-container');
  },

  /**
   * Show a toast notification
   * @param {string} message - Message to display
   * @param {'success'|'error'|'warning'} type - Toast type
   * @param {number} duration - Duration in ms (default 4000)
   */
  show(message, type = 'success', duration = 4000) {
    const toastEl = document.createElement('div');
    toastEl.className = `toast toast-${type}`;
    toastEl.innerHTML = `
      <span class="toast-message">${this.escapeHtml(message)}</span>
      <button class="toast-close" aria-label="Close">&times;</button>
    `;

    const closeBtn = toastEl.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.dismiss(toastEl));

    this.container.appendChild(toastEl);

    // Auto-dismiss
    setTimeout(() => this.dismiss(toastEl), duration);
  },

  /**
   * Dismiss a toast
   * @param {HTMLElement} toastEl - Toast element
   */
  dismiss(toastEl) {
    if (!toastEl.parentNode) return;

    toastEl.classList.add('toast-exit');
    setTimeout(() => {
      if (toastEl.parentNode) {
        toastEl.parentNode.removeChild(toastEl);
      }
    }, 200);
  },

  /**
   * Escape HTML to prevent XSS
   * @param {string} str - String to escape
   * @returns {string}
   */
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // Convenience methods
  success(message) {
    this.show(message, 'success');
  },

  error(message) {
    this.show(message, 'error');
  },

  warning(message) {
    this.show(message, 'warning');
  },
};

// =============================================================================
// Polls Module
// =============================================================================

const polls = {
  /**
   * Load and display all polls
   */
  async loadPolls() {
    ui.showLoading('polls');

    try {
      const response = await api.polls.list();
      state.polls = response.data || [];

      if (state.polls.length === 0) {
        ui.showEmpty('polls');
      } else {
        this.renderPollList(state.polls);
        ui.$('poll-list').classList.remove('hidden');
        ui.hideLoading('polls');
      }
    } catch (error) {
      console.error('Failed to load polls:', error);
      ui.showError('polls');
    }
  },

  /**
   * Render the poll list
   * @param {Array} pollsData - Array of poll objects
   */
  renderPollList(pollsData) {
    const container = ui.$('poll-list');
    container.innerHTML = pollsData.map((poll) => this.createPollCard(poll)).join('');

    // Add click handlers
    container.querySelectorAll('.poll-card').forEach((card) => {
      card.addEventListener('click', () => {
        const pollId = card.dataset.pollId;
        this.loadPollDetail(pollId);
      });
    });
  },

  /**
   * Create HTML for a poll card
   * @param {object} poll - Poll object
   * @returns {string}
   */
  createPollCard(poll) {
    const date = new Date(poll.created_at * 1000).toLocaleDateString();
    return `
      <article class="poll-card" data-poll-id="${poll.id}">
        <div class="poll-card-header">
          <h2 class="poll-card-title">${this.escapeHtml(poll.title)}</h2>
          ${poll.description ? `<p class="poll-card-description">${this.escapeHtml(poll.description)}</p>` : ''}
        </div>
        <div class="poll-card-meta">
          <span class="poll-card-votes">${poll.total_votes} votes</span>
          <span class="poll-card-date">${date}</span>
        </div>
      </article>
    `;
  },

  /**
   * Load and display a single poll
   * @param {string} pollId - Poll ID
   */
  async loadPollDetail(pollId) {
    ui.showSection('poll-view');
    ui.showLoading('poll-view');

    try {
      const response = await api.polls.get(pollId);
      state.currentPoll = response.data;
      this.renderPollDetail(state.currentPoll);
      ui.$('poll-view-content').classList.remove('hidden');
      ui.hideLoading('poll-view');
    } catch (error) {
      console.error('Failed to load poll:', error);
      ui.showError('poll-view');
    }
  },

  /**
   * Render poll detail view
   * @param {object} poll - Poll object with options
   */
  renderPollDetail(poll) {
    const container = ui.$('poll-view-content');
    const totalVotes = poll.total_votes || 0;

    container.innerHTML = `
      <h1 class="poll-detail-title">${this.escapeHtml(poll.title)}</h1>
      ${poll.description ? `<p class="poll-detail-description">${this.escapeHtml(poll.description)}</p>` : ''}

      <div class="poll-options-list">
        ${poll.options.map((option) => this.createOptionElement(option, totalVotes)).join('')}
      </div>

      <div class="poll-detail-footer">
        <span class="poll-total-votes">${totalVotes} total votes</span>
        <button id="btn-vote" class="btn btn-primary" disabled>
          <span class="btn-text">Vote</span>
          <span class="btn-loading hidden">
            <span class="spinner-small"></span> Voting...
          </span>
        </button>
      </div>
    `;

    // Add option click handlers
    this.setupOptionHandlers();
  },

  /**
   * Create HTML for a poll option
   * @param {object} option - Option object
   * @param {number} totalVotes - Total votes for percentage calculation
   * @returns {string}
   */
  createOptionElement(option, totalVotes) {
    const percentage = totalVotes > 0 ? Math.round((option.vote_count / totalVotes) * 100) : 0;
    return `
      <div class="poll-option" data-option-id="${option.id}">
        <div class="poll-option-radio"></div>
        <div class="poll-option-content">
          <div class="poll-option-text">${this.escapeHtml(option.text)}</div>
          <div class="poll-option-bar">
            <div class="poll-option-bar-fill" style="width: ${percentage}%"></div>
          </div>
        </div>
        <div class="poll-option-count">${option.vote_count} (${percentage}%)</div>
      </div>
    `;
  },

  /**
   * Setup click handlers for poll options
   */
  setupOptionHandlers() {
    const options = document.querySelectorAll('.poll-option');
    const voteBtn = ui.$('btn-vote');
    let selectedOption = null;

    options.forEach((option) => {
      option.addEventListener('click', () => {
        // Remove selection from all options
        options.forEach((o) => o.classList.remove('selected'));

        // Select this option
        option.classList.add('selected');
        selectedOption = option.dataset.optionId;

        // Enable vote button
        voteBtn.disabled = false;
      });
    });

    // Vote button handler
    voteBtn.addEventListener('click', async () => {
      if (!selectedOption) return;
      await this.submitVote(state.currentPoll.id, selectedOption);
    });
  },

  /**
   * Submit a vote
   * @param {string} pollId - Poll ID
   * @param {string} optionId - Selected option ID
   */
  async submitVote(pollId, optionId) {
    const voteBtn = ui.$('btn-vote');
    const btnText = voteBtn.querySelector('.btn-text');
    const btnLoading = voteBtn.querySelector('.btn-loading');

    voteBtn.disabled = true;
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');

    try {
      // Generate a simple fingerprint (will be replaced with FingerprintJS in Phase 6)
      const fingerprint = await this.getFingerprint();

      await api.polls.vote(pollId, optionId, fingerprint);
      toast.success('Your vote has been recorded!');

      // Reload poll to show updated counts
      await this.loadPollDetail(pollId);
    } catch (error) {
      console.error('Failed to vote:', error);
      toast.error(error.message || 'Failed to submit vote');

      // Re-enable button
      voteBtn.disabled = false;
      btnText.classList.remove('hidden');
      btnLoading.classList.add('hidden');
    }
  },

  /**
   * Generate a simple browser fingerprint
   * This will be replaced with FingerprintJS in Phase 6
   * @returns {Promise<string>}
   */
  async getFingerprint() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('fingerprint', 0, 0);

    const components = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      canvas.toDataURL(),
    ];

    const str = components.join('|');

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return Math.abs(hash).toString(16);
  },

  /**
   * Escape HTML to prevent XSS
   * @param {string} str - String to escape
   * @returns {string}
   */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};

// =============================================================================
// Auth Module
// =============================================================================

const auth = {
  /**
   * Initialize auth state from storage
   */
  init() {
    state.token = storage.getToken();
    state.user = storage.getUser();
    ui.updateNav();
  },

  /**
   * Handle login form submission
   * @param {Event} event - Form submit event
   */
  async handleLogin(event) {
    event.preventDefault();
    const form = event.target;

    ui.hideFormError('login');
    ui.setFormLoading(form, true);

    const email = form.email.value.trim();
    const password = form.password.value;

    try {
      const response = await api.auth.login(email, password);

      state.token = response.data.token;
      state.user = response.data.user;

      storage.setToken(state.token);
      storage.setUser(state.user);

      ui.updateNav();
      ui.showSection('poll-dashboard');
      toast.success('Welcome back!');
      form.reset();
    } catch (error) {
      ui.showFormError('login', error.message || 'Login failed');
    } finally {
      ui.setFormLoading(form, false);
    }
  },

  /**
   * Handle register form submission
   * @param {Event} event - Form submit event
   */
  async handleRegister(event) {
    event.preventDefault();
    const form = event.target;

    ui.hideFormError('register');

    const email = form.email.value.trim();
    const password = form.password.value;
    const confirm = form.confirm.value;

    // Validate passwords match
    if (password !== confirm) {
      ui.showFormError('register', 'Passwords do not match');
      return;
    }

    ui.setFormLoading(form, true);

    try {
      const response = await api.auth.register(email, password);

      state.token = response.data.token;
      state.user = response.data.user;

      storage.setToken(state.token);
      storage.setUser(state.user);

      ui.updateNav();
      ui.showSection('poll-dashboard');
      toast.success('Account created successfully!');
      form.reset();
    } catch (error) {
      ui.showFormError('register', error.message || 'Registration failed');
    } finally {
      ui.setFormLoading(form, false);
    }
  },

  /**
   * Handle logout
   */
  logout() {
    state.token = null;
    state.user = null;
    storage.clearAuth();
    ui.updateNav();
    ui.showSection('poll-dashboard');
    toast.success('You have been logged out');
  },
};

// =============================================================================
// Create Poll Module
// =============================================================================

const createPoll = {
  /**
   * Initialize create poll form
   */
  init() {
    this.setupAddOptionButton();
  },

  /**
   * Setup add option button handler
   */
  setupAddOptionButton() {
    const addBtn = ui.$('btn-add-option');
    const optionsContainer = ui.$('poll-options');

    addBtn.addEventListener('click', () => {
      const optionCount = optionsContainer.querySelectorAll('.option-input').length;
      if (optionCount >= 10) {
        toast.warning('Maximum 10 options allowed');
        return;
      }

      const optionDiv = document.createElement('div');
      optionDiv.className = 'option-input';
      optionDiv.innerHTML = `
        <input type="text" name="options[]" required maxlength="100" placeholder="Option ${optionCount + 1}">
        <button type="button" class="btn-remove" aria-label="Remove option">&times;</button>
      `;

      optionsContainer.appendChild(optionDiv);

      // Add remove handler
      const removeBtn = optionDiv.querySelector('.btn-remove');
      removeBtn.addEventListener('click', () => {
        const currentCount = optionsContainer.querySelectorAll('.option-input').length;
        if (currentCount > 2) {
          optionDiv.remove();
          this.updatePlaceholders();
        } else {
          toast.warning('Minimum 2 options required');
        }
      });
    });
  },

  /**
   * Update option placeholders after removal
   */
  updatePlaceholders() {
    const inputs = document.querySelectorAll('#poll-options input');
    inputs.forEach((input, index) => {
      input.placeholder = `Option ${index + 1}`;
    });
  },

  /**
   * Handle create poll form submission
   * @param {Event} event - Form submit event
   */
  async handleSubmit(event) {
    event.preventDefault();
    const form = event.target;

    ui.hideFormError('create-poll');

    const title = form.title.value.trim();
    const description = form.description.value.trim();
    const optionInputs = form.querySelectorAll('input[name="options[]"]');
    const options = Array.from(optionInputs)
      .map((input) => input.value.trim())
      .filter((value) => value.length > 0);

    // Validate
    if (options.length < 2) {
      ui.showFormError('create-poll', 'Please provide at least 2 options');
      return;
    }

    ui.setFormLoading(form, true);

    try {
      const response = await api.polls.create({ title, description, options });
      toast.success('Poll created successfully!');
      form.reset();

      // Reset options to just 2
      const optionsContainer = ui.$('poll-options');
      optionsContainer.innerHTML = `
        <div class="option-input">
          <input type="text" name="options[]" required maxlength="100" placeholder="Option 1">
        </div>
        <div class="option-input">
          <input type="text" name="options[]" required maxlength="100" placeholder="Option 2">
        </div>
      `;

      // Navigate to the new poll
      const newPollId = response.data.id;
      await polls.loadPollDetail(newPollId);
    } catch (error) {
      ui.showFormError('create-poll', error.message || 'Failed to create poll');
    } finally {
      ui.setFormLoading(form, false);
    }
  },

  /**
   * Cancel poll creation
   */
  cancel() {
    ui.showSection('poll-dashboard');
  },
};

// =============================================================================
// Event Handlers Setup
// =============================================================================

function setupEventHandlers() {
  // Navigation
  ui.$('nav-home').addEventListener('click', () => {
    ui.showSection('poll-dashboard');
    polls.loadPolls();
  });

  // Auth navigation
  ui.$('btn-show-login').addEventListener('click', () => ui.showSection('login-section'));
  ui.$('btn-show-register').addEventListener('click', () => ui.showSection('register-section'));
  ui.$('btn-switch-to-register').addEventListener('click', () => ui.showSection('register-section'));
  ui.$('btn-switch-to-login').addEventListener('click', () => ui.showSection('login-section'));
  ui.$('btn-logout').addEventListener('click', () => auth.logout());

  // Create poll
  ui.$('btn-create-poll').addEventListener('click', () => {
    if (!state.user) {
      toast.warning('Please login to create a poll');
      ui.showSection('login-section');
      return;
    }
    ui.showSection('create-poll-section');
  });

  // Back to polls
  ui.$('btn-back-to-polls').addEventListener('click', () => {
    ui.showSection('poll-dashboard');
    polls.loadPolls();
  });

  // Retry buttons
  ui.$('btn-retry-polls').addEventListener('click', () => polls.loadPolls());
  ui.$('btn-retry-poll').addEventListener('click', () => {
    if (state.currentPoll) {
      polls.loadPollDetail(state.currentPoll.id);
    }
  });

  // Forms
  ui.$('login-form').addEventListener('submit', (e) => auth.handleLogin(e));
  ui.$('register-form').addEventListener('submit', (e) => auth.handleRegister(e));
  ui.$('create-poll-form').addEventListener('submit', (e) => createPoll.handleSubmit(e));
  ui.$('btn-cancel-create').addEventListener('click', () => createPoll.cancel());
}

// =============================================================================
// Application Initialization
// =============================================================================

async function init() {
  console.log('Vote System initializing...');

  // Initialize modules
  toast.init();
  auth.init();
  createPoll.init();

  // Setup event handlers
  setupEventHandlers();

  // Load initial data
  await polls.loadPolls();

  console.log('Vote System ready!');
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
