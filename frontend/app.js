/**
 * VoteHub - Modern Voting Platform
 * Firebase Google OAuth Integration
 */

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  API_BASE_URL: window.ENV?.API_URL || 'http://localhost:8787/api',
  STORAGE_KEYS: {
    USER: 'vote_system_user',
    VOTED_POLLS: 'vote_system_voted_polls',
    FINGERPRINT: 'vote_system_fingerprint',
  },
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
  myPolls: [],
  currentPoll: null,
  currentSection: 'poll-dashboard',
  currentTab: 'all',
  authInitialized: false,
  pollToDelete: null,
};

// =============================================================================
// Firebase Module
// =============================================================================

const firebaseAuth = {
  init() {
    firebase.initializeApp(CONFIG.FIREBASE);

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

  async signInWithGoogle() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await firebase.auth().signInWithPopup(provider);
    } catch (error) {
      console.error('Google sign-in error:', error);
      if (error.code === 'auth/popup-closed-by-user') {
        toast.warning('Sign-in cancelled');
      } else {
        toast.error(error.message || 'Failed to sign in with Google');
      }
    }
  },

  async signOut() {
    try {
      await firebase.auth().signOut();
      toast.success('You have been logged out');
      // Reset to all polls view
      state.currentTab = 'all';
      ui.showSection('poll-dashboard');
      polls.loadPolls();
    } catch (error) {
      console.error('Sign-out error:', error);
      toast.error('Failed to sign out');
    }
  },

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
      await firebase.auth().signOut();
    }
  },
};

// =============================================================================
// API Module
// =============================================================================

const api = {
  async request(endpoint, options = {}) {
    const url = `${CONFIG.API_BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

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

  polls: {
    async list() {
      return api.request('/polls');
    },

    async listMine() {
      return api.request('/polls/me');
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

    async update(id, pollData) {
      return api.request(`/polls/${id}`, {
        method: 'PUT',
        body: JSON.stringify(pollData),
      });
    },

    async delete(id) {
      return api.request(`/polls/${id}`, {
        method: 'DELETE',
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
  elements: {},

  $(id) {
    if (!this.elements[id]) {
      this.elements[id] = document.getElementById(id);
    }
    return this.elements[id];
  },

  showSection(sectionId) {
    const sections = [
      'poll-dashboard',
      'poll-view',
      'create-poll-section',
      'edit-poll-section',
    ];

    sections.forEach((id) => {
      const section = this.$(id);
      if (section) {
        section.classList.toggle('hidden', id !== sectionId);
      }
    });

    // Show/hide hero based on section
    const hero = this.$('hero-section');
    if (hero) {
      hero.classList.toggle('hidden', sectionId !== 'poll-dashboard');
    }

    state.currentSection = sectionId;
  },

  updateNav() {
    const authNav = this.$('auth-nav');
    const userNav = this.$('user-nav');
    const userPhoto = this.$('user-photo');
    const userName = this.$('user-name');
    const navMyPolls = this.$('nav-my-polls');

    if (state.user && state.firebaseUser) {
      authNav.classList.add('hidden');
      userNav.classList.remove('hidden');
      navMyPolls.classList.remove('hidden');

      if (state.user.photoUrl || state.firebaseUser.photoURL) {
        userPhoto.src = state.user.photoUrl || state.firebaseUser.photoURL;
        userPhoto.classList.remove('hidden');
      } else {
        userPhoto.classList.add('hidden');
      }

      userName.textContent = state.user.displayName || state.user.email || 'User';
    } else {
      authNav.classList.remove('hidden');
      userNav.classList.add('hidden');
      navMyPolls.classList.add('hidden');

      // Reset to all polls tab if logged out
      state.currentTab = 'all';
      this.updateTabState();
    }
  },

  updateTabState() {
    const allTab = this.$('nav-all-polls');
    const myTab = this.$('nav-my-polls');
    const sectionTitle = this.$('section-title');
    const sectionSubtitle = this.$('section-subtitle');

    allTab.classList.toggle('active', state.currentTab === 'all');
    myTab.classList.toggle('active', state.currentTab === 'my');

    if (state.currentTab === 'my') {
      sectionTitle.textContent = 'My Polls';
      sectionSubtitle.textContent = 'Manage polls you have created';
    } else {
      sectionTitle.textContent = 'All Polls';
      sectionSubtitle.textContent = 'Browse and vote on community polls';
    }
  },

  updateStats(pollsData) {
    const statPolls = this.$('stat-polls');
    const statVotes = this.$('stat-votes');

    if (statPolls && statVotes) {
      statPolls.textContent = pollsData.length;
      const totalVotes = pollsData.reduce((sum, poll) => sum + (poll.total_votes || 0), 0);
      statVotes.textContent = totalVotes;
    }
  },

  showLoading(containerId) {
    const loading = this.$(`${containerId}-loading`);
    const content = this.$(containerId === 'polls' ? 'poll-list' : `${containerId}-content`);
    const empty = this.$(`${containerId}-empty`);
    const error = this.$(`${containerId}-error`);

    if (loading) loading.classList.remove('hidden');
    if (content) content.classList.add('hidden');
    if (empty) empty.classList.add('hidden');
    if (error) error.classList.add('hidden');
  },

  hideLoading(containerId) {
    const loading = this.$(`${containerId}-loading`);
    if (loading) loading.classList.add('hidden');
  },

  showError(containerId) {
    const loading = this.$(`${containerId}-loading`);
    const error = this.$(`${containerId}-error`);

    if (loading) loading.classList.add('hidden');
    if (error) error.classList.remove('hidden');
  },

  showEmpty(containerId) {
    const loading = this.$(`${containerId}-loading`);
    const empty = this.$(`${containerId}-empty`);

    if (loading) loading.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
  },

  setFormLoading(form, isLoading) {
    const submitBtn = form.querySelector('button[type="submit"]');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoading = submitBtn.querySelector('.btn-loading');

    submitBtn.disabled = isLoading;
    if (btnText) btnText.classList.toggle('hidden', isLoading);
    if (btnLoading) btnLoading.classList.toggle('hidden', !isLoading);

    form.querySelectorAll('input, textarea, button').forEach((el) => {
      el.disabled = isLoading;
    });
  },

  showFormError(formId, message) {
    const errorEl = this.$(`${formId}-error`);
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
  },

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

  show(message, type = 'success', duration = 4000) {
    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    };

    const toastEl = document.createElement('div');
    toastEl.className = `toast toast-${type}`;
    toastEl.innerHTML = `
      <div class="toast-icon">${icons[type]}</div>
      <span class="toast-message">${this.escapeHtml(message)}</span>
      <button class="toast-close" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;

    const closeBtn = toastEl.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.dismiss(toastEl));

    this.container.appendChild(toastEl);

    setTimeout(() => this.dismiss(toastEl), duration);
  },

  dismiss(toastEl) {
    if (!toastEl.parentNode) return;

    toastEl.classList.add('toast-exit');
    setTimeout(() => {
      if (toastEl.parentNode) {
        toastEl.parentNode.removeChild(toastEl);
      }
    }, 200);
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

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
  async loadPolls() {
    ui.showLoading('polls');

    try {
      let response;
      if (state.currentTab === 'my') {
        response = await api.polls.listMine();
        state.myPolls = response.data || [];
        this.renderPollList(state.myPolls, true);
      } else {
        response = await api.polls.list();
        state.polls = response.data || [];
        ui.updateStats(state.polls);
        this.renderPollList(state.polls, false);
      }

      const pollsData = state.currentTab === 'my' ? state.myPolls : state.polls;

      if (pollsData.length === 0) {
        ui.showEmpty('polls');
      } else {
        ui.$('poll-list').classList.remove('hidden');
        ui.hideLoading('polls');
      }
    } catch (error) {
      console.error('Failed to load polls:', error);
      ui.showError('polls');
    }
  },

  renderPollList(pollsData, isOwner = false) {
    const container = ui.$('poll-list');
    container.innerHTML = pollsData.map((poll) => this.createPollCard(poll, isOwner)).join('');

    // Add click handlers for poll cards
    container.querySelectorAll('.poll-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        // Don't navigate if clicking on action buttons
        if (e.target.closest('.poll-card-action')) return;

        const pollId = card.dataset.pollId;
        this.loadPollDetail(pollId);
      });
    });

    // Add edit button handlers
    container.querySelectorAll('.poll-card-action.edit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pollId = btn.closest('.poll-card').dataset.pollId;
        const poll = (state.currentTab === 'my' ? state.myPolls : state.polls).find(p => p.id === pollId);
        if (poll) {
          editPoll.show(poll);
        }
      });
    });

    // Add delete button handlers
    container.querySelectorAll('.poll-card-action.danger').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pollId = btn.closest('.poll-card').dataset.pollId;
        deleteModal.show(pollId);
      });
    });
  },

  createPollCard(poll, showActions = false) {
    const date = new Date(poll.created_at * 1000).toLocaleDateString();
    const isOwner = state.user && poll.user_id === state.user.id;
    const shouldShowActions = showActions || isOwner;
    const totalVotes = poll.total_votes || 0;

    // Sort options by vote count (descending) and take top options for display
    const sortedOptions = [...(poll.options || [])].sort((a, b) => b.vote_count - a.vote_count);
    const displayOptions = sortedOptions.slice(0, 4); // Show top 4 options

    return `
      <article class="poll-card" data-poll-id="${poll.id}">
        <div class="poll-card-header">
          <h3 class="poll-card-title">
            ${this.escapeHtml(poll.title)}
            ${isOwner && state.currentTab === 'all' ? '<span class="owner-badge">Your Poll</span>' : ''}
          </h3>
          ${poll.description ? `<p class="poll-card-description">${this.escapeHtml(poll.description)}</p>` : ''}
        </div>
        <div class="poll-card-stats">
          ${displayOptions.map((option) => {
            const percentage = totalVotes > 0 ? Math.round((option.vote_count / totalVotes) * 100) : 0;
            return `
              <div class="poll-card-stat-item">
                <div class="poll-card-stat-header">
                  <span class="poll-card-stat-label">${this.escapeHtml(option.text)}</span>
                  <span class="poll-card-stat-value">${percentage}%</span>
                </div>
                <div class="poll-card-stat-bar">
                  <div class="poll-card-stat-bar-fill" style="width: ${percentage}%"></div>
                </div>
              </div>
            `;
          }).join('')}
          ${sortedOptions.length > 4 ? `<div class="poll-card-more">+${sortedOptions.length - 4} more options</div>` : ''}
        </div>
        <div class="poll-card-footer">
          <div class="poll-card-meta">
            <span class="poll-card-votes">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              ${totalVotes} votes
            </span>
            <span class="poll-card-date">${date}</span>
          </div>
          ${shouldShowActions ? `
            <div class="poll-card-actions">
              <button class="poll-card-action edit" title="Edit poll">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button class="poll-card-action danger" title="Delete poll">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          ` : ''}
        </div>
      </article>
    `;
  },

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

  renderPollDetail(poll) {
    const container = ui.$('poll-view-content');
    const totalVotes = poll.total_votes || 0;
    const hasVoted = storage.hasVotedOnPoll(poll.id);
    const votedOptionId = storage.getVotedOptionId(poll.id);
    const isOwner = state.user && poll.user_id === state.user.id;

    container.innerHTML = `
      <div class="poll-detail">
        <div class="poll-detail-header">
          <h1 class="poll-detail-title">${this.escapeHtml(poll.title)}</h1>
          ${isOwner ? `
            <div class="poll-detail-actions">
              <button class="poll-detail-action" id="btn-edit-poll">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Edit
              </button>
              <button class="poll-detail-action danger" id="btn-delete-poll">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
                Delete
              </button>
            </div>
          ` : ''}
        </div>
        ${poll.description ? `<p class="poll-detail-description">${this.escapeHtml(poll.description)}</p>` : ''}

        <div class="poll-options-list">
          ${poll.options.map((option) => this.createOptionElement(option, totalVotes, hasVoted, votedOptionId)).join('')}
        </div>

        <div class="poll-detail-footer">
          <span class="poll-total-votes">${totalVotes} total votes</span>
          ${hasVoted
            ? `<span class="voted-message">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                You voted on this poll
              </span>`
            : `<button id="btn-vote" class="btn btn-primary" disabled>
                <span class="btn-text">Vote</span>
                <span class="btn-loading hidden">
                  <span class="spinner-small"></span>
                  Voting...
                </span>
              </button>`
          }
        </div>
      </div>
    `;

    if (!hasVoted) {
      this.setupOptionHandlers();
    }

    // Setup edit/delete handlers for owner
    if (isOwner) {
      const editBtn = document.getElementById('btn-edit-poll');
      const deleteBtn = document.getElementById('btn-delete-poll');

      if (editBtn) {
        editBtn.addEventListener('click', () => {
          editPoll.show(poll);
        });
      }

      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
          deleteModal.show(poll.id);
        });
      }
    }
  },

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

  setupOptionHandlers() {
    const options = document.querySelectorAll('.poll-option');
    const voteBtn = ui.$('btn-vote');
    let selectedOption = null;

    options.forEach((option) => {
      option.addEventListener('click', () => {
        options.forEach((o) => o.classList.remove('selected'));
        option.classList.add('selected');
        selectedOption = option.dataset.optionId;
        voteBtn.disabled = false;
      });
    });

    voteBtn.addEventListener('click', async () => {
      if (!selectedOption) return;
      await this.submitVote(state.currentPoll.id, selectedOption);
    });
  },

  async submitVote(pollId, optionId) {
    const voteBtn = ui.$('btn-vote');
    const btnText = voteBtn.querySelector('.btn-text');
    const btnLoading = voteBtn.querySelector('.btn-loading');

    voteBtn.disabled = true;
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');

    const options = document.querySelectorAll('.poll-option');
    options.forEach((opt) => opt.classList.add('disabled'));

    try {
      const fingerprint = await this.getFingerprint();

      this.updateVoteCountOptimistic(optionId, 1);

      const response = await api.polls.vote(pollId, optionId, fingerprint);

      storage.setVotedPoll(pollId, optionId);

      this.updateVoteCountFromResponse(optionId, response.data);

      toast.success('Your vote has been recorded!');

      this.renderPollDetail(state.currentPoll);
    } catch (error) {
      console.error('Failed to vote:', error);

      this.updateVoteCountOptimistic(optionId, -1);

      if (error.message && error.message.includes('already voted')) {
        storage.setVotedPoll(pollId, optionId);
        toast.warning('You have already voted on this poll');
        this.renderPollDetail(state.currentPoll);
      } else {
        toast.error(error.message || 'Failed to submit vote');
        voteBtn.disabled = false;
        btnText.classList.remove('hidden');
        btnLoading.classList.add('hidden');
        options.forEach((opt) => opt.classList.remove('disabled'));
      }
    }
  },

  updateVoteCountOptimistic(optionId, delta) {
    if (!state.currentPoll) return;

    const option = state.currentPoll.options.find((o) => o.id === optionId);
    if (option) {
      option.vote_count += delta;
      state.currentPoll.total_votes += delta;
    }

    const optionEl = document.querySelector(`.poll-option[data-option-id="${optionId}"]`);
    if (optionEl) {
      const totalVotes = state.currentPoll.total_votes;

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

      const totalEl = document.querySelector('.poll-total-votes');
      if (totalEl) totalEl.textContent = `${totalVotes} total votes`;
    }
  },

  updateVoteCountFromResponse(optionId, data) {
    if (!state.currentPoll || !data) return;

    const option = state.currentPoll.options.find((o) => o.id === optionId);
    if (option) {
      option.vote_count = data.new_vote_count;
      state.currentPoll.total_votes = data.new_total_votes;
    }
  },

  async getFingerprint() {
    const cached = storage.getFingerprint();
    if (cached) {
      return cached;
    }

    let fingerprint;

    try {
      if (typeof FingerprintJS !== 'undefined') {
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        fingerprint = result.visitorId;
      } else {
        fingerprint = await this.generateSimpleFingerprint();
      }
    } catch (error) {
      console.warn('FingerprintJS failed, using fallback:', error);
      fingerprint = await this.generateSimpleFingerprint();
    }

    storage.setFingerprint(fingerprint);
    return fingerprint;
  },

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

    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return 'fp_' + Math.abs(hash).toString(16);
  },

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
  init() {
    this.setupAddOptionButton();
    this.setupInitialRemoveButtons();
  },

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
        <span class="option-number">${optionCount + 1}</span>
        <input type="text" name="options[]" required maxlength="100" placeholder="Enter option">
        <button type="button" class="btn-remove" aria-label="Remove option">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      `;

      optionsContainer.appendChild(optionDiv);

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

  updatePlaceholders() {
    const inputs = document.querySelectorAll('#poll-options .option-input');
    inputs.forEach((input, index) => {
      const numberSpan = input.querySelector('.option-number');
      if (numberSpan) {
        numberSpan.textContent = index + 1;
      }
    });
  },

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

    if (options.length < 2) {
      ui.showFormError('create-poll', 'Please provide at least 2 options');
      return;
    }

    ui.setFormLoading(form, true);

    try {
      const response = await api.polls.create({ title, description, options });
      toast.success('Poll created successfully!');
      form.reset();

      const optionsContainer = ui.$('poll-options');
      optionsContainer.innerHTML = `
        <div class="option-input">
          <span class="option-number">1</span>
          <input type="text" name="options[]" required maxlength="100" placeholder="Enter option">
          <button type="button" class="btn-remove" aria-label="Remove option">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="option-input">
          <span class="option-number">2</span>
          <input type="text" name="options[]" required maxlength="100" placeholder="Enter option">
          <button type="button" class="btn-remove" aria-label="Remove option">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      `;

      this.setupInitialRemoveButtons();

      const newPollId = response.data.id;
      await polls.loadPollDetail(newPollId);
    } catch (error) {
      ui.showFormError('create-poll', error.message || 'Failed to create poll');
    } finally {
      ui.setFormLoading(form, false);
    }
  },

  cancel() {
    ui.showSection('poll-dashboard');
  },
};

// =============================================================================
// Edit Poll Module
// =============================================================================

const editPoll = {
  show(poll) {
    ui.$('edit-poll-id').value = poll.id;
    ui.$('edit-poll-title').value = poll.title;
    ui.$('edit-poll-description').value = poll.description || '';
    ui.hideFormError('edit-poll');
    ui.showSection('edit-poll-section');
  },

  async handleSubmit(event) {
    event.preventDefault();
    const form = event.target;

    ui.hideFormError('edit-poll');

    const pollId = ui.$('edit-poll-id').value;
    const title = form.title.value.trim();
    const description = form.description.value.trim();

    if (!title) {
      ui.showFormError('edit-poll', 'Title is required');
      return;
    }

    ui.setFormLoading(form, true);

    try {
      await api.polls.update(pollId, { title, description });
      toast.success('Poll updated successfully!');

      // Reload the poll detail
      await polls.loadPollDetail(pollId);
    } catch (error) {
      ui.showFormError('edit-poll', error.message || 'Failed to update poll');
      ui.setFormLoading(form, false);
    }
  },

  cancel() {
    if (state.currentPoll) {
      polls.loadPollDetail(state.currentPoll.id);
    } else {
      ui.showSection('poll-dashboard');
    }
  },
};

// =============================================================================
// Delete Modal Module
// =============================================================================

const deleteModal = {
  show(pollId) {
    state.pollToDelete = pollId;
    ui.$('delete-modal').classList.remove('hidden');
  },

  hide() {
    state.pollToDelete = null;
    ui.$('delete-modal').classList.add('hidden');
  },

  async confirm() {
    if (!state.pollToDelete) return;

    const confirmBtn = ui.$('btn-confirm-delete');
    const btnText = confirmBtn.querySelector('.btn-text');
    const btnLoading = confirmBtn.querySelector('.btn-loading');

    confirmBtn.disabled = true;
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');

    try {
      await api.polls.delete(state.pollToDelete);
      toast.success('Poll deleted successfully!');
      this.hide();

      // Go back to poll list
      ui.showSection('poll-dashboard');
      polls.loadPolls();
    } catch (error) {
      toast.error(error.message || 'Failed to delete poll');
    } finally {
      confirmBtn.disabled = false;
      btnText.classList.remove('hidden');
      btnLoading.classList.add('hidden');
    }
  },
};

// =============================================================================
// User Menu Module
// =============================================================================

const userMenu = {
  init() {
    const menuBtn = ui.$('user-menu-btn');
    const dropdown = ui.$('user-dropdown');

    if (!menuBtn || !dropdown) return;

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menuBtn.classList.toggle('open');
      dropdown.classList.toggle('hidden');
    });

    // Close menu when clicking outside
    document.addEventListener('click', () => {
      menuBtn.classList.remove('open');
      dropdown.classList.add('hidden');
    });
  },
};

// =============================================================================
// Event Handlers Setup
// =============================================================================

function setupEventHandlers() {
  // Tab navigation
  ui.$('nav-all-polls').addEventListener('click', () => {
    state.currentTab = 'all';
    ui.updateTabState();
    ui.showSection('poll-dashboard');
    polls.loadPolls();
  });

  ui.$('nav-my-polls').addEventListener('click', () => {
    if (!state.user) {
      toast.warning('Please sign in to view your polls');
      return;
    }
    state.currentTab = 'my';
    ui.updateTabState();
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

  // Back buttons
  ui.$('btn-back-to-polls').addEventListener('click', () => {
    ui.showSection('poll-dashboard');
    polls.loadPolls();
  });

  ui.$('btn-back-from-create').addEventListener('click', () => {
    ui.showSection('poll-dashboard');
  });

  ui.$('btn-back-from-edit').addEventListener('click', () => {
    editPoll.cancel();
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

  ui.$('edit-poll-form').addEventListener('submit', (e) => editPoll.handleSubmit(e));
  ui.$('btn-cancel-edit').addEventListener('click', () => editPoll.cancel());

  // Delete modal
  ui.$('btn-cancel-delete').addEventListener('click', () => deleteModal.hide());
  ui.$('btn-confirm-delete').addEventListener('click', () => deleteModal.confirm());
  ui.$('delete-modal').querySelector('.modal-backdrop').addEventListener('click', () => deleteModal.hide());
}

// =============================================================================
// Application Initialization
// =============================================================================

async function init() {
  console.log('VoteHub initializing...');

  // Initialize modules
  toast.init();
  firebaseAuth.init();
  createPoll.init();
  userMenu.init();

  // Setup event handlers
  setupEventHandlers();

  // Load initial data
  await polls.loadPolls();

  console.log('VoteHub ready!');
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
