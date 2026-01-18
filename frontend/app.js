/**
 * Vote System - Frontend Application
 * Firebase Google OAuth Integration
 */

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  // API URL: Uses environment variable in production, falls back to localhost for dev
  // For Cloudflare Pages, set this via Pages environment variables
  API_BASE_URL: window.ENV?.API_URL || 'http://localhost:8787/api',
  STORAGE_KEYS: {
    USER: 'vote_system_user',
    VOTED_POLLS: 'vote_system_voted_polls',
    FINGERPRINT: 'vote_system_fingerprint',
  },
  // Firebase configuration - Replace with your actual Firebase config
  FIREBASE: {
    apiKey: window.ENV?.FIREBASE_API_KEY || 'YOUR_API_KEY',
    authDomain: window.ENV?.FIREBASE_AUTH_DOMAIN || 'your-project.firebaseapp.com',
    projectId: window.ENV?.FIREBASE_PROJECT_ID || 'your-project-id',
  },
};

// =============================================================================
// State Management
// =============================================================================

const state = {
  user: null,
  firebaseUser: null,
  polls: [],
  currentPoll: null,
  currentSection: 'poll-dashboard',
  authInitialized: false,
};

// =============================================================================
// Firebase Module
// =============================================================================

const firebaseAuth = {
  /**
   * Initialize Firebase
   */
  init() {
    firebase.initializeApp(CONFIG.FIREBASE);

    // Listen for auth state changes
    firebase.auth().onAuthStateChanged(async (firebaseUser) => {
      state.authInitialized = true;

      if (firebaseUser) {
        state.firebaseUser = firebaseUser;
        await this.syncWithBackend(firebaseUser);
      } else {
        state.firebaseUser = null;
        state.user = null;
        storage.remove(CONFIG.STORAGE_KEYS.USER);
      }

      ui.updateNav();
    });
  },

  /**
   * Sign in with Google popup
   */
  async signInWithGoogle() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await firebase.auth().signInWithPopup(provider);
      // onAuthStateChanged will handle the rest
    } catch (error) {
      console.error('Google sign-in error:', error);
      if (error.code === 'auth/popup-closed-by-user') {
        toast.warning('Sign-in cancelled');
      } else {
        toast.error(error.message || 'Failed to sign in with Google');
      }
    }
  },

  /**
   * Sign out
   */
  async signOut() {
    try {
      await firebase.auth().signOut();
      toast.success('You have been logged out');
    } catch (error) {
      console.error('Sign-out error:', error);
      toast.error('Failed to sign out');
    }
  },

  /**
   * Get fresh ID token for API requests
   * @returns {Promise<string|null>}
   */
  async getIdToken() {
    if (!state.firebaseUser) {
      return null;
    }
    try {
      return await state.firebaseUser.getIdToken(true);
    } catch (error) {
      console.error('Failed to get ID token:', error);
      return null;
    }
  },

  /**
   * Sync Firebase user with backend
   * @param {firebase.User} firebaseUser
   */
  async syncWithBackend(firebaseUser) {
    try {
      const idToken = await firebaseUser.getIdToken();

      const response = await fetch(`${CONFIG.API_BASE_URL}/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync with backend');
      }

      state.user = data.data.user;
      storage.set(CONFIG.STORAGE_KEYS.USER, state.user);

      toast.success(`Welcome, ${state.user.displayName || state.user.email}!`);
    } catch (error) {
      console.error('Backend sync error:', error);
      toast.error('Failed to complete sign-in');
      // Sign out from Firebase if backend sync fails
      await firebase.auth().signOut();
    }
  },
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

    // Add Firebase ID token if user is authenticated
    if (state.firebaseUser) {
      const idToken = await firebaseAuth.getIdToken();
      if (idToken) {
        headers['Authorization'] = `Bearer ${idToken}`;
      }
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

  // Voted polls helpers
  getVotedPolls() {
    return this.get(CONFIG.STORAGE_KEYS.VOTED_POLLS) || {};
  },

  setVotedPoll(pollId, optionId) {
    const votedPolls = this.getVotedPolls();
    votedPolls[pollId] = optionId;
    this.set(CONFIG.STORAGE_KEYS.VOTED_POLLS, votedPolls);
  },

  hasVotedOnPoll(pollId) {
    const votedPolls = this.getVotedPolls();
    return pollId in votedPolls;
  },

  getVotedOptionId(pollId) {
    const votedPolls = this.getVotedPolls();
    return votedPolls[pollId] || null;
  },

  // Fingerprint helpers
  getFingerprint() {
    return this.get(CONFIG.STORAGE_KEYS.FINGERPRINT);
  },

  setFingerprint(fingerprint) {
    this.set(CONFIG.STORAGE_KEYS.FINGERPRINT, fingerprint);
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
    const userPhoto = this.$('user-photo');
    const userName = this.$('user-name');

    if (state.user && state.firebaseUser) {
      authNav.classList.add('hidden');
      userNav.classList.remove('hidden');

      // Set user photo
      if (state.user.photoUrl || state.firebaseUser.photoURL) {
        userPhoto.src = state.user.photoUrl || state.firebaseUser.photoURL;
        userPhoto.classList.remove('hidden');
      } else {
        userPhoto.classList.add('hidden');
      }

      // Set user name
      userName.textContent = state.user.displayName || state.user.email || 'User';
    } else {
      authNav.classList.remove('hidden');
      userNav.classList.add('hidden');
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
    const hasVoted = storage.hasVotedOnPoll(poll.id);
    const votedOptionId = storage.getVotedOptionId(poll.id);

    container.innerHTML = `
      <h1 class="poll-detail-title">${this.escapeHtml(poll.title)}</h1>
      ${poll.description ? `<p class="poll-detail-description">${this.escapeHtml(poll.description)}</p>` : ''}

      <div class="poll-options-list">
        ${poll.options.map((option) => this.createOptionElement(option, totalVotes, hasVoted, votedOptionId)).join('')}
      </div>

      <div class="poll-detail-footer">
        <span class="poll-total-votes">${totalVotes} total votes</span>
        ${hasVoted
          ? '<span class="voted-message">You have voted on this poll</span>'
          : `<button id="btn-vote" class="btn btn-primary" disabled>
              <span class="btn-text">Vote</span>
              <span class="btn-loading hidden">
                <span class="spinner-small"></span> Voting...
              </span>
            </button>`
        }
      </div>
    `;

    // Add option click handlers only if user hasn't voted
    if (!hasVoted) {
      this.setupOptionHandlers();
    }
  },

  /**
   * Create HTML for a poll option
   * @param {object} option - Option object
   * @param {number} totalVotes - Total votes for percentage calculation
   * @param {boolean} hasVoted - Whether user has voted on this poll
   * @param {string} votedOptionId - The option ID the user voted for
   * @returns {string}
   */
  createOptionElement(option, totalVotes, hasVoted = false, votedOptionId = null) {
    const percentage = totalVotes > 0 ? Math.round((option.vote_count / totalVotes) * 100) : 0;
    const isVotedOption = option.id === votedOptionId;
    const classes = ['poll-option'];

    if (hasVoted) {
      classes.push('voted');
      if (isVotedOption) {
        classes.push('user-vote');
      }
    }

    return `
      <div class="${classes.join(' ')}" data-option-id="${option.id}">
        <div class="poll-option-radio">${isVotedOption ? '<span class="checkmark"></span>' : ''}</div>
        <div class="poll-option-content">
          <div class="poll-option-text">
            ${this.escapeHtml(option.text)}
            ${isVotedOption ? '<span class="your-vote-badge">Your vote</span>' : ''}
          </div>
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

    // Disable all options during voting
    const options = document.querySelectorAll('.poll-option');
    options.forEach((opt) => opt.classList.add('disabled'));

    try {
      const fingerprint = await this.getFingerprint();

      // Optimistic UI update
      this.updateVoteCountOptimistic(optionId, 1);

      const response = await api.polls.vote(pollId, optionId, fingerprint);

      // Store voted state in local storage
      storage.setVotedPoll(pollId, optionId);

      // Update with actual server response for accuracy
      this.updateVoteCountFromResponse(optionId, response.data);

      toast.success('Your vote has been recorded!');

      // Re-render to show voted state
      this.renderPollDetail(state.currentPoll);
    } catch (error) {
      console.error('Failed to vote:', error);

      // Revert optimistic update
      this.updateVoteCountOptimistic(optionId, -1);

      // Handle specific error types
      if (error.message && error.message.includes('already voted')) {
        // Mark as voted locally even if server says already voted
        storage.setVotedPoll(pollId, optionId);
        toast.warning('You have already voted on this poll');
        // Re-render to show voted state
        this.renderPollDetail(state.currentPoll);
      } else {
        toast.error(error.message || 'Failed to submit vote');
        // Re-enable voting UI
        voteBtn.disabled = false;
        btnText.classList.remove('hidden');
        btnLoading.classList.add('hidden');
        options.forEach((opt) => opt.classList.remove('disabled'));
      }
    }
  },

  /**
   * Optimistically update vote count in UI
   * @param {string} optionId - Option ID
   * @param {number} delta - Change amount (+1 or -1)
   */
  updateVoteCountOptimistic(optionId, delta) {
    if (!state.currentPoll) return;

    // Update state
    const option = state.currentPoll.options.find((o) => o.id === optionId);
    if (option) {
      option.vote_count += delta;
      state.currentPoll.total_votes += delta;
    }

    // Update DOM
    const optionEl = document.querySelector(`.poll-option[data-option-id="${optionId}"]`);
    if (optionEl) {
      const totalVotes = state.currentPoll.total_votes;
      const percentage = totalVotes > 0 ? Math.round((option.vote_count / totalVotes) * 100) : 0;

      const countEl = optionEl.querySelector('.poll-option-count');
      const barEl = optionEl.querySelector('.poll-option-bar-fill');
      const totalEl = document.querySelector('.poll-total-votes');

      if (countEl) countEl.textContent = `${option.vote_count} (${percentage}%)`;
      if (barEl) barEl.style.width = `${percentage}%`;
      if (totalEl) totalEl.textContent = `${totalVotes} total votes`;

      // Update all option percentages
      state.currentPoll.options.forEach((opt) => {
        const el = document.querySelector(`.poll-option[data-option-id="${opt.id}"]`);
        if (el) {
          const pct = totalVotes > 0 ? Math.round((opt.vote_count / totalVotes) * 100) : 0;
          const cEl = el.querySelector('.poll-option-count');
          const bEl = el.querySelector('.poll-option-bar-fill');
          if (cEl) cEl.textContent = `${opt.vote_count} (${pct}%)`;
          if (bEl) bEl.style.width = `${pct}%`;
        }
      });
    }
  },

  /**
   * Update vote counts from server response
   * @param {string} optionId - Option ID
   * @param {object} data - Response data with new counts
   */
  updateVoteCountFromResponse(optionId, data) {
    if (!state.currentPoll || !data) return;

    // Update state with server values
    const option = state.currentPoll.options.find((o) => o.id === optionId);
    if (option) {
      option.vote_count = data.new_vote_count;
      state.currentPoll.total_votes = data.new_total_votes;
    }
  },

  /**
   * Generate browser fingerprint using FingerprintJS
   * Falls back to simple fingerprint if FingerprintJS is not available
   * @returns {Promise<string>}
   */
  async getFingerprint() {
    // Check if we have a cached fingerprint
    const cached = storage.getFingerprint();
    if (cached) {
      return cached;
    }

    let fingerprint;

    try {
      // Try to use FingerprintJS if available
      if (typeof FingerprintJS !== 'undefined') {
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        fingerprint = result.visitorId;
      } else {
        // Fallback to simple fingerprint
        fingerprint = await this.generateSimpleFingerprint();
      }
    } catch (error) {
      console.warn('FingerprintJS failed, using fallback:', error);
      fingerprint = await this.generateSimpleFingerprint();
    }

    // Cache the fingerprint
    storage.setFingerprint(fingerprint);
    return fingerprint;
  },

  /**
   * Generate a simple fallback fingerprint
   * @returns {Promise<string>}
   */
  async generateSimpleFingerprint() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('fingerprint', 0, 0);

    const components = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      canvas.toDataURL(),
      navigator.hardwareConcurrency || 'unknown',
      navigator.platform,
    ];

    const str = components.join('|');

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return 'fp_' + Math.abs(hash).toString(16);
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
// Create Poll Module
// =============================================================================

const createPoll = {
  /**
   * Initialize create poll form
   */
  init() {
    this.setupAddOptionButton();
    this.setupInitialRemoveButtons();
  },

  /**
   * Setup remove handlers for initial option buttons
   */
  setupInitialRemoveButtons() {
    const optionsContainer = ui.$('poll-options');
    const removeButtons = optionsContainer.querySelectorAll('.btn-remove');

    removeButtons.forEach((removeBtn) => {
      removeBtn.addEventListener('click', () => {
        const currentCount = optionsContainer.querySelectorAll('.option-input').length;
        if (currentCount > 2) {
          removeBtn.closest('.option-input').remove();
          this.updatePlaceholders();
        } else {
          toast.warning('Minimum 2 options required');
        }
      });
    });
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
          <button type="button" class="btn-remove" aria-label="Remove option">&times;</button>
        </div>
        <div class="option-input">
          <input type="text" name="options[]" required maxlength="100" placeholder="Option 2">
          <button type="button" class="btn-remove" aria-label="Remove option">&times;</button>
        </div>
      `;

      // Re-setup remove handlers for reset options
      this.setupInitialRemoveButtons();

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

  // Google Sign-in
  ui.$('btn-google-signin').addEventListener('click', () => {
    firebaseAuth.signInWithGoogle();
  });

  // Logout
  ui.$('btn-logout').addEventListener('click', () => {
    firebaseAuth.signOut();
  });

  // Create poll
  ui.$('btn-create-poll').addEventListener('click', () => {
    if (!state.user) {
      toast.warning('Please sign in to create a poll');
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
  firebaseAuth.init();
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
