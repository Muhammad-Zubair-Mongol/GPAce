(function () {
  'use strict';
  const key = 'gpace-flashcards-local-v1';
  const $ = id => document.getElementById(id);
  let decks = [];
  let currentDeckId = null;
  let studyIndex = 0;
  function read() {
    try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; }
    catch { return []; }
  }
  function save() { localStorage.setItem(key, JSON.stringify(decks)); }
  function current() { return decks.find(deck => deck.id === currentDeckId); }
  function modal(id) { return bootstrap.Modal.getOrCreateInstance($(id)); }
  function whenReady(id, fn) {
    if (modal(id)._isTransitioning) $(id).addEventListener('shown.bs.modal', fn, { once: true });
    else fn();
  }
  function notice(message) { const el = $('flashcardsLocalStatus'); if (el) el.textContent = message; }
  function subjects() {
    const select = $('deckSubject');
    let list = [];
    try { list = JSON.parse(localStorage.getItem('academicSubjects') || '[]'); } catch {}
    if (!Array.isArray(list) || !list.length) {
      try {
        const semesters = JSON.parse(localStorage.getItem('academicSemesters') || '{}');
        const semester = localStorage.getItem('currentAcademicSemester') || 'default';
        list = semesters[semester]?.subjects || [];
      } catch {}
    }
    select.replaceChildren(new Option('General', 'general'));
    for (const item of list) {
      const name = item.name || item.title || item.tag;
      if (name) select.add(new Option(name, item.tag || name));
    }
  }
  function render() {
    const list = $('decksList'); list.replaceChildren();
    if (!decks.length) {
      const empty = document.createElement('div'); empty.className = 'col-12 text-center py-5';
      empty.innerHTML = '<i class="bi bi-card-list fs-1" aria-hidden="true"></i><p class="mt-3">No flashcard decks yet. Create one to get started.</p>';
      list.append(empty); return;
    }
    for (const deck of decks) {
      const col = document.createElement('div'); col.className = 'col-md-6 mb-3';
      const card = document.createElement('button'); card.type = 'button'; card.className = 'card deck-card w-100 text-start p-3';
      const title = document.createElement('strong'); title.textContent = deck.title;
      const description = document.createElement('span'); description.className = 'd-block'; description.textContent = `${deck.subjectName} � ${deck.cards.length} cards`;
      card.append(title, description); card.addEventListener('click', () => openDeck(deck.id)); col.append(card); list.append(col);
    }
  }
  function openDeck(id) {
    currentDeckId = id; const deck = current(); if (!deck) return;
    $('deckDetailTitle').textContent = deck.title;
    $('deckDetailSubject').textContent = deck.subjectName;
    $('deckDetailDescription').textContent = deck.description || '';
    $('cardCount').textContent = `${deck.cards.length} cards`;
    $('dueCount').textContent = `${deck.cards.length} due`;
    const table = $('cardsTableBody'); table.replaceChildren();
    for (const card of deck.cards) {
      const tr = document.createElement('tr');
      for (const text of [card.question, card.answer, card.nextReview ? new Date(card.nextReview).toLocaleDateString() : 'Now']) {
        const td = document.createElement('td'); td.textContent = text; tr.append(td);
      }
      const td = document.createElement('td'); const remove = document.createElement('button');
      remove.className = 'btn btn-sm btn-outline-danger'; remove.textContent = 'Delete';
      remove.addEventListener('click', () => { deck.cards = deck.cards.filter(value => value.id !== card.id); save(); openDeck(id); });
      td.append(remove); tr.append(td); table.append(tr);
    }
    modal('deckDetailsModal').show();
  }
  function study() {
    const deck = current(); if (!deck?.cards.length) { notice('Add a card before studying.'); return; }
    $('deckDetailsModal').addEventListener('hidden.bs.modal', () => { studyIndex = 0; renderStudy(); modal('studyModal').show(); }, { once: true });
    whenReady('deckDetailsModal', () => modal('deckDetailsModal').hide());
  }
  function renderStudy() {
    const deck = current(), card = deck.cards[studyIndex];
    if (!card) { modal('studyModal').hide(); notice('Study session complete.'); return; }
    $('currentFlashcard').classList.remove('flipped');
    $('questionContent').textContent = card.question; $('answerContent').textContent = card.answer;
    $('progressCounter').textContent = `${studyIndex + 1}/${deck.cards.length}`;
    $('ratingContainer').style.display = 'none'; $('flipCardPrompt').style.display = 'block';
  }
  function flip() { $('currentFlashcard').classList.add('flipped'); $('ratingContainer').style.display = 'block'; $('flipCardPrompt').style.display = 'none'; }
  function rate(n) {
    const card = current()?.cards[studyIndex]; if (!card) return;
    const days = [0, 1, 2, 4, 7, 14][n]; card.nextReview = Date.now() + days * 86400000; card.lastRating = n; save();
    studyIndex += 1; renderStudy();
  }
  function init() {
    if (window.FlashcardsController || !$('createDeckBtn') || !window.bootstrap?.Modal) return;
    decks = read(); subjects(); render();
    const status = document.createElement('p'); status.id = 'flashcardsLocalStatus'; status.className = 'flashcards-local-status'; status.setAttribute('role', 'status');
    status.textContent = 'Saved on this device'; $('main-content').prepend(status);
    $('createDeckBtn').addEventListener('click', () => { $('createDeckForm').reset(); modal('createDeckModal').show(); });
    $('saveDeckBtn').addEventListener('click', () => {
      const title = $('deckTitle').value.trim(), subject = $('deckSubject');
      if (!title) { $('deckTitle').reportValidity(); return; }
      decks.unshift({ id: crypto.randomUUID(), title, subjectName: subject.selectedOptions[0]?.textContent || 'General', description: $('deckDescription').value.trim(), cards: [] });
      save(); render(); modal('createDeckModal').hide(); notice('Deck created on this device.');
    });
    $('addCardBtn').addEventListener('click', () => { $('addCardForm').reset(); $('deckDetailsModal').addEventListener('hidden.bs.modal', () => modal('addCardModal').show(), { once: true }); whenReady('deckDetailsModal', () => modal('deckDetailsModal').hide()); });
    $('saveCardBtn').addEventListener('click', () => {
      const question = $('cardQuestion').value.trim(), answer = $('cardAnswer').value.trim(), deck = current();
      if (!question || !answer || !deck) { $('addCardForm').reportValidity(); return; }
      deck.cards.push({ id: crypto.randomUUID(), question, answer, nextReview: null });
      save(); $('addCardModal').addEventListener('hidden.bs.modal', () => openDeck(deck.id), { once: true }); whenReady('addCardModal', () => modal('addCardModal').hide());
    });
    $('deleteDeckBtn').addEventListener('click', () => { const deck = current(); if (!deck || !confirm(`Delete ${deck.title}?`)) return; decks = decks.filter(value => value.id !== deck.id); save(); modal('deckDetailsModal').hide(); render(); });
    $('studyDeckBtn').addEventListener('click', study); $('flipCardBtn').addEventListener('click', flip);
    document.querySelectorAll('.rating-btn').forEach(button => button.addEventListener('click', () => rate(Number(button.dataset.rating))));
    document.addEventListener('keydown', event => {
      if (!$('studyModal').classList.contains('show')) return;
      if (event.code === 'Space') { event.preventDefault(); flip(); }
      if (/^[1-5]$/.test(event.key)) rate(Number(event.key));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
