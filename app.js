// app.js - full file (copy-paste ready)

// Data model and constants
const INTERVALS = [60, 300, 720, 1440, 2880, 4320, 10080, 20160, 43200, 129600, 172800, 216000, 259200]; // in minutes
const STORAGE_KEY = 'vocabularyFlashcards';
const LISTS_STORAGE_KEY = 'vocabularyFlashcardsLists';
const CURRENT_LIST_KEY = 'vocabularyFlashcardsCurrentList';
const NIGHT_MODE_KEY = 'vocabularyFlashcardsNightMode';

// IndexedDB & file-binding constants
const IDB_DB_NAME = 'vocabFlashcardsDB';
const IDB_STORE = 'data';
const IDB_KEY = 'cards-and-lists';

// State management
let cards = [];
let lists = [];
let currentListId = null;
let currentSession = {
    cards: [],
    currentIndex: 0,
    correctCount: 0,
    type: '' // 'learn' or 'practice'
};

// File binding handle
let fileHandle = null;

// DOM Elements
const views = {
    dashboard: document.getElementById('dashboardView'),
    practice: document.getElementById('practiceView'),
    summary: document.getElementById('summaryView'),
    stats: document.getElementById('statsView'),
    import: document.getElementById('importView')
};

const sideNav = document.getElementById('sideNav');
const overlay = document.getElementById('overlay');
const burgerBtn = document.getElementById('burgerBtn');

// Initialize the application
function init() {
    initStorageEnhancements().then(() => {
        loadLists();
        loadCards();
        updateDashboard();
        setupEventListeners();
        updateLanguageSelector();

        // Initialize night mode from saved preference
        const savedNight = localStorage.getItem(NIGHT_MODE_KEY);
        const isNight = savedNight === 'true';
        applyNightMode(isNight);

        updateFileStatusUI();
    });
}

// Apply or remove night mode (purely layout/theme)
function applyNightMode(enable) {
    if (enable) {
        document.body.classList.add('night-mode');
        const btn = document.getElementById('nightModeToggle');
        if (btn) btn.textContent = '☀️';
    } else {
        document.body.classList.remove('night-mode');
        const btn = document.getElementById('nightModeToggle');
        if (btn) btn.textContent = '🌙';
    }
}

// Toggle night mode and persist preference
function toggleNightMode() {
    const isNight = document.body.classList.toggle('night-mode');
    // update button icon
    const btn = document.getElementById('nightModeToggle');
    if (btn) btn.textContent = isNight ? '☀️' : '🌙';
    // persist preference
    localStorage.setItem(NIGHT_MODE_KEY, isNight ? 'true' : 'false');
}

// Load lists from localStorage
function loadLists() {
    const storedLists = localStorage.getItem(LISTS_STORAGE_KEY);
    if (storedLists) {
        lists = JSON.parse(storedLists);
    }

    // If no lists exist, create a default one
    if (!lists || lists.length === 0) {
        lists = [{
            id: generateId(),
            name: 'Default List',
            createdAt: new Date().toISOString()
        }];
        saveLists();
    }

    // Load current list ID
    const storedCurrentListId = localStorage.getItem(CURRENT_LIST_KEY);
    currentListId = storedCurrentListId || lists[0].id;

    // Ensure currentListId exists (in case the stored id was deleted externally)
    if (!lists.find(l => l.id === currentListId)) {
        currentListId = lists[0].id;
        localStorage.setItem(CURRENT_LIST_KEY, currentListId);
    }

    renderLists();
}

// Save lists to localStorage (and IDB backup)
function saveLists() {
    localStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(lists));
    // also save backup to IDB
    idbSave(IDB_KEY, { lists: lists, cards: getAllCardsFromStorage() }).catch(() => {});
}

// Render lists in the side nav
function renderLists() {
    const listsContainer = document.getElementById('listsContainer');
    if (!listsContainer) return;
    listsContainer.innerHTML = '';

    lists.forEach(list => {
        const listElement = document.createElement('div');
        listElement.className = `list-item ${list.id === currentListId ? 'active' : ''}`;

        // Left: name
        const nameSpan = document.createElement('span');
        nameSpan.textContent = list.name;
        nameSpan.style.flex = '1';

        // Right: delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-list-btn';
        deleteBtn.title = 'Delete list';
        deleteBtn.type = 'button'; // Ensure it behaves as a non-form button
        deleteBtn.innerHTML = '🗑️';

        // click to select list (except when clicking delete)
        listElement.addEventListener('click', () => {
            currentListId = list.id;
            localStorage.setItem(CURRENT_LIST_KEY, currentListId);
            loadCards();
            renderLists();
            updateDashboard();

            // close the side nav after selection (nice UX)
            closeSideNav();
        });

        // ===== Fix for touch devices: attach both click and touchstart with guard =====
        (function attachDeleteHandlers(btn, listId) {
            let handled = false;
            const doDelete = (e) => {
                // stop parent list click
                if (e) {
                    try { e.stopPropagation(); } catch (err) {}
                    try { e.preventDefault(); } catch (err) {}
                }

                // prevent double-firing (touchstart -> click)
                if (handled) return;
                handled = true;

                // call deletion
                deleteList(listId);

                // small timeout to allow click events to be ignored
                setTimeout(() => { handled = false; }, 400);
            };

            // Regular click (desktop)
            btn.addEventListener('click', doDelete);

            // Touch devices: touchstart triggers earlier than click; make sure it works.
            // We add with passive:false so preventDefault() works if necessary.
            btn.addEventListener('touchstart', doDelete, { passive: false });

            // Also attach pointerdown as a fallback for pointer-enabled devices
            btn.addEventListener('pointerdown', function(e){
                // if pointer type is touch, we'll let touchstart handle it; but pointerdown is a useful fallback
                if (e.pointerType === 'mouse') return; // mouse handled by click
                doDelete(e);
            });
        })(deleteBtn, list.id);

        listElement.appendChild(nameSpan);
        listElement.appendChild(deleteBtn);

        listsContainer.appendChild(listElement);
    });
}

// Delete a list and its associated cards
function deleteList(listId) {
    const toDelete = lists.find(l => l.id === listId);
    if (!toDelete) return;

    const confirmMsg = `Delete the list "${toDelete.name}" and ALL its cards? This action cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    // Remove list from lists array
    lists = lists.filter(l => l.id !== listId);
    saveLists();

    // Remove cards belonging to that list from storage
    const storedCardsStr = localStorage.getItem(STORAGE_KEY);
    let allCards = storedCardsStr ? JSON.parse(storedCardsStr) : [];
    allCards = allCards.filter(c => c.listId !== listId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allCards));

    // update IDB backup
    idbSave(IDB_KEY, { lists: lists, cards: allCards }).catch(()=>{});

    // If deleted list was the current one, switch to a different list or create default
    if (currentListId === listId) {
        if (lists.length > 0) {
            currentListId = lists[0].id;
            localStorage.setItem(CURRENT_LIST_KEY, currentListId);
        } else {
            // create default list
            const defaultList = {
                id: generateId(),
                name: 'Default List',
                createdAt: new Date().toISOString()
            };
            lists = [defaultList];
            saveLists();
            currentListId = defaultList.id;
            localStorage.setItem(CURRENT_LIST_KEY, currentListId);
        }
    }

    // Reload current list's cards into memory and update UI
    loadCards();
    renderLists();
    updateDashboard();
    alert('List deleted.');
}

// Get card count for a specific list
function getCardCountForList(listId) {
    // We want counts from persistent storage (all cards), not only the currently-loaded "cards" array
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return 0;
    const all = JSON.parse(stored);
    return all.filter(card => card.listId === listId).length;
}

// Load cards from storage for current list (enhanced: localStorage -> IDB fallback)
async function loadCards() {
    const storedCards = localStorage.getItem(STORAGE_KEY);
    if (storedCards) {
        const allCards = JSON.parse(storedCards);
        cards = allCards.filter(card => card.listId === currentListId);

        // Ensure all cards have the known property (for backward compatibility)
        cards = cards.map(card => {
            if (card.known === undefined) {
                card.known = false;
            }
            return card;
        });
        return;
    }

    // fallback to IDB
    try {
        const data = await idbGet(IDB_KEY);
        if (data && data.cards) {
            const allCards = data.cards;
            cards = allCards.filter(card => card.listId === currentListId);
            cards = cards.map(card => {
                if (card.known === undefined) {
                    card.known = false;
                }
                return card;
            });

            // sync to localStorage for compatibility
            localStorage.setItem(STORAGE_KEY, JSON.stringify(allCards));
            return;
        }
    } catch (err) {
        console.warn('IDB fallback failed', err);
    }

    // nothing found
    cards = [];
}

// Save cards to storage (localStorage + IDB + optional bound file)
async function saveCards() {
    // First load all cards
    const storedCards = localStorage.getItem(STORAGE_KEY);
    let allCards = storedCards ? JSON.parse(storedCards) : [];

    // Remove current list's cards
    allCards = allCards.filter(card => card.listId !== currentListId);

    // Add current list's cards
    allCards = allCards.concat(cards);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(allCards));

    // Backup to IDB
    try {
        await idbSave(IDB_KEY, { lists: lists, cards: allCards, currentListId });
    } catch (err) {
        console.warn('Could not save backup to IDB:', err);
    }

    // If user bound a file, write to it too
    try {
        await writeDataToBoundFile();
    } catch (err) {
        console.warn('Error auto-saving to file:', err);
    }
}

// Update dashboard statistics
function updateDashboard() {
    const totalCards = cards.length;
    const neverPracticed = cards.filter(card => !card.practiced && !card.known).length;
    const readyToPractice = cards.filter(card => isCardReadyToPractice(card) && !card.known).length;
    const knownWords = cards.filter(card => card.known).length;

    document.getElementById('totalCards').textContent = totalCards;
    document.getElementById('neverPracticed').textContent = neverPracticed;
    document.getElementById('readyToPractice').textContent = readyToPractice;
    document.getElementById('knownWords').textContent = knownWords;

    // Enable/disable buttons based on card availability
    document.getElementById('learnNewBtn').disabled = neverPracticed === 0;
    document.getElementById('practiceLearnedBtn').disabled = readyToPractice === 0;
}

// Check if a card is ready to practice
function isCardReadyToPractice(card) {
    if (!card.practiced || card.known) return false;

    const now = new Date();
    const dueDate = new Date(card.nextDueAt);

    return card.successRate < 0.7 || now >= dueDate;
}

// Switch between views
function showView(viewName) {
    Object.keys(views).forEach(key => {
        views[key].classList.remove('active');
    });
    views[viewName].classList.add('active');
}

// Generate a unique ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// Start a learning session with new words
function startLearnSession() {
    const batchSize = parseInt(document.getElementById('batchSize').value);
    const direction = document.getElementById('direction').value;

    const newWords = cards.filter(card => !card.practiced && !card.known);
    if (newWords.length === 0) {
        alert('No new words to learn!');
        return;
    }

    // Shuffle and select cards
    const selectedCards = shuffleArray(newWords).slice(0, batchSize);

    currentSession = {
        cards: selectedCards,
        currentIndex: 0,
        correctCount: 0,
        type: 'learn',
        direction: direction
    };

    showPracticeCard();
    showView('practice');
}

// Start a practice session with learned words
function startPracticeSession() {
    const batchSize = parseInt(document.getElementById('batchSize').value);
    const direction = document.getElementById('direction').value;

    const readyCards = cards.filter(card => isCardReadyToPractice(card));
    if (readyCards.length === 0) {
        alert('No cards are ready to practice right now. Please wait until due time or until more cards fall below 70%.');
        return;
    }

    // Shuffle and select cards
    const selectedCards = shuffleArray(readyCards).slice(0, batchSize);

    currentSession = {
        cards: selectedCards,
        currentIndex: 0,
        correctCount: 0,
        type: 'practice',
        direction: direction
    };

    showPracticeCard();
    showView('practice');
}

// Display the current practice card
function showPracticeCard() {
    const { currentIndex, cards: sessionCards, direction } = currentSession;
    const card = sessionCards[currentIndex];

    if (!card) {
        endSession();
        return;
    }

    document.getElementById('progressText').textContent =
        `Question ${currentIndex + 1} of ${sessionCards.length}`;

    // Set question based on direction
    const isWordToMeaning = direction === 'wordToMeaning';
    document.getElementById('questionText').textContent = isWordToMeaning ? card.word : card.meaning;

    // Generate options
    const optionsContainer = document.getElementById('optionsContainer');
    optionsContainer.innerHTML = '';

    // Get correct answer and distractors
    const correctAnswer = isWordToMeaning ? card.meaning : card.word;
    const distractors = getDistractors(card, isWordToMeaning);

    // Combine and shuffle options
    const allOptions = [correctAnswer, ...distractors];
    const shuffledOptions = shuffleArray(allOptions);

    // Create option elements
    shuffledOptions.forEach(option => {
        const optionElement = document.createElement('div');
        optionElement.className = 'option';
        optionElement.textContent = option;
        optionElement.addEventListener('click', () => checkAnswer(option, correctAnswer));
        optionsContainer.appendChild(optionElement);
    });

    // Show card actions
    document.getElementById('cardActions').style.display = 'flex';

    // Hide feedback
    document.getElementById('feedback').style.display = 'none';
}

// Get distractors for multiple choice options
function getDistractors(card, isWordToMeaning) {
    // Filter out the current card and get cards from current list only
    const otherCards = cards.filter(c => c.id !== card.id && c.listId === currentListId && !c.known);

    // If we don't have enough cards, return fewer distractors
    if (otherCards.length < 3) {
        return otherCards.map(d => isWordToMeaning ? d.meaning : d.word);
    }

    // Shuffle and take up to 3
    const shuffled = shuffleArray(otherCards);
    const distractors = shuffled.slice(0, 3);

    // Return the appropriate field (word or meaning)
    return distractors.map(d => isWordToMeaning ? d.meaning : d.word);
}

// Check if the selected answer is correct
function checkAnswer(selectedAnswer, correctAnswer) {
    const isCorrect = selectedAnswer === correctAnswer;
    const card = currentSession.cards[currentSession.currentIndex];

    // Update card stats
    card.timesShown = (card.timesShown || 0) + 1;
    if (isCorrect) {
        card.correctCount = (card.correctCount || 0) + 1;
    } else {
        card.wrongCount = (card.wrongCount || 0) + 1;
    }

    card.successRate = (card.correctCount || 0) / ((card.correctCount || 0) + (card.wrongCount || 0));
    card.lastAskedAt = new Date().toISOString();

    // For new cards in learning session, initialize scheduling
    if (currentSession.type === 'learn') {
        card.practiced = true;
        card.scheduleIndex = 1;
    } else {
        // For practice session, update scheduling
        if (isCorrect) {
            card.scheduleIndex = Math.min((card.scheduleIndex || 0) + 1, INTERVALS.length - 1);
        } else {
            card.scheduleIndex = Math.max(0, (card.scheduleIndex || 0) - 1);
        }
    }

    // Calculate next due date
    const intervalMinutes = INTERVALS[card.scheduleIndex || 0];
    const nextDueDate = new Date();
    nextDueDate.setMinutes(nextDueDate.getMinutes() + intervalMinutes);
    card.nextDueAt = nextDueDate.toISOString();

    // Update session stats
    if (isCorrect) {
        currentSession.correctCount++;
    }

    // Show feedback
    const feedbackElement = document.getElementById('feedback');
    feedbackElement.textContent = isCorrect ? 'Correct!' : `Incorrect. The answer is: ${correctAnswer}`;
    feedbackElement.className = `feedback ${isCorrect ? 'correct' : 'incorrect'}`;
    feedbackElement.style.display = 'block';

    // Disable options
    const options = document.querySelectorAll('.option');
    options.forEach(option => {
        option.style.pointerEvents = 'none';
        if (option.textContent === correctAnswer) {
            option.classList.add('correct');
        } else if (option.textContent === selectedAnswer && !isCorrect) {
            option.classList.add('incorrect');
        }
    });

    // Auto-advance after delay
    setTimeout(() => {
        currentSession.currentIndex++;

        if (currentSession.currentIndex < currentSession.cards.length) {
            showPracticeCard();
        } else {
            endSession();
        }

        saveCards();
    }, 700);
}

// End the current session and show summary
function endSession() {
    const { correctCount, cards: sessionCards, type } = currentSession;
    const totalQuestions = sessionCards.length;
    const accuracy = totalQuestions > 0 ? (correctCount / totalQuestions * 100).toFixed(1) : 0;

    document.getElementById('summaryTitle').textContent =
        type === 'learn' ? 'Learning Session Complete' : 'Practice Session Complete';
    document.getElementById('summaryText').textContent =
        `You got ${correctCount} out of ${totalQuestions} correct (${accuracy}% accuracy).`;

    showView('summary');
    updateDashboard();
}

// Mark current card as known
function markCurrentCardAsKnown() {
    const card = currentSession.cards[currentSession.currentIndex];
    if (card) {
        card.known = true;
        saveCards();

        // Move to next card
        currentSession.currentIndex++;
        if (currentSession.currentIndex < currentSession.cards.length) {
            showPracticeCard();
        } else {
            endSession();
        }
    }
}

// Delete current card
function deleteCurrentCard() {
    const card = currentSession.cards[currentSession.currentIndex];
    if (card && confirm(`Are you sure you want to delete the card "${card.word}"?`)) {
        // Remove from current session
        currentSession.cards.splice(currentSession.currentIndex, 1);

        // Remove from main cards array
        const cardIndex = cards.findIndex(c => c.id === card.id);
        if (cardIndex !== -1) {
            cards.splice(cardIndex, 1);
            saveCards();
            updateDashboard();
        }

        // Check if we have more cards in the session
        if (currentSession.currentIndex < currentSession.cards.length) {
            showPracticeCard();
        } else if (currentSession.cards.length === 0) {
            // No more cards in session
            endSession();
        } else {
            // We were at the last card, so move back one
            currentSession.currentIndex--;
            showPracticeCard();
        }
    }
}

// Show statistics table with sorting
function showStatistics(filter = 'availableNow') {
    const tableBody = document.getElementById('statsTableBody');
    tableBody.innerHTML = '';

    let filteredCards = [];

    switch (filter) {
        case 'availableNow':
            filteredCards = cards.filter(isCardReadyToPractice);
            break;
        case 'neverPracticed':
            filteredCards = cards.filter(card => !card.practiced && !card.known);
            break;
        case 'knownWords':
            filteredCards = cards.filter(card => card.known);
            break;
        default:
            filteredCards = [...cards];
    }

    // Apply sorting if any
    const sortHeader = document.querySelector('th[data-sort-direction="asc"], th[data-sort-direction="desc"]');
    if (sortHeader) {
        const sortBy = sortHeader.dataset.sort;
        const sortDirection = sortHeader.dataset.sortDirection;

        filteredCards.sort((a, b) => {
            let valueA = a[sortBy];
            let valueB = b[sortBy];

            // Handle special cases
            if (sortBy === 'nextDueAt') {
                valueA = valueA ? new Date(valueA).getTime() : 0;
                valueB = valueB ? new Date(valueB).getTime() : 0;
            }

            if (valueA < valueB) return sortDirection === 'asc' ? -1 : 1;
            if (valueA > valueB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }

    filteredCards.forEach(card => {
        const row = document.createElement('tr');

        // Format last asked date
        const lastAsked = card.lastAskedAt ?
            new Date(card.lastAskedAt).toLocaleDateString() : 'Never';

        // Format next due date with time
        let nextDue = 'Not scheduled';
        let dueBadge = '';
        if (card.nextDueAt) {
            const dueDate = new Date(card.nextDueAt);
            nextDue = dueDate.toLocaleString(); // Show both date and time

            const now = new Date();
            if (dueDate < now) {
                dueBadge = '<span class="badge danger">Overdue</span>';
            } else if ((dueDate - now) < 24 * 60 * 60 * 1000) {
                dueBadge = '<span class="badge warning">Due soon</span>';
            } else {
                dueBadge = '<span class="badge success">Scheduled</span>';
            }
        }

        // Format success rate
        let successRate = 'N/A';
        let successBadge = '';
        if (card.practiced && (card.timesShown || 0) > 0) {
            successRate = `${((card.successRate || 0) * 100).toFixed(1)}%`;

            if ((card.successRate || 0) >= 0.7) {
                successBadge = '<span class="badge success">Good</span>';
            } else if ((card.successRate || 0) >= 0.5) {
                successBadge = '<span class="badge warning">Needs work</span>';
            } else {
                successBadge = '<span class="badge danger">Poor</span>';
            }
        }

        // Known status
        const knownStatus = card.known ? 'Yes' : 'No';
        const knownBadge = card.known ?
            '<span class="badge success">Known</span>' :
            '<span class="badge warning">Learning</span>';

        row.innerHTML = `
            <td>${card.word}</td>
            <td>${card.meaning}</td>
            <td>${card.practiced ? 'Yes' : 'No'}</td>
            <td>${successRate} ${successBadge}</td>
            <td>${nextDue} ${dueBadge}</td>
            <td>${knownStatus} ${knownBadge}</td>
            <td class="action-buttons">
                <button class="mark-known-btn" data-id="${card.id}">${card.known ? 'Mark Unknown' : 'Mark Known'}</button>
                <button class="delete-card-btn danger" data-id="${card.id}">Delete</button>
            </td>
        `;

        tableBody.appendChild(row);
    });

    // Add event listeners to the action buttons
    document.querySelectorAll('.mark-known-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const cardId = e.target.dataset.id;
            toggleCardKnownStatus(cardId);
        });
    });

    document.querySelectorAll('.delete-card-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const cardId = e.target.dataset.id;
            deleteCardFromStats(cardId);
        });
    });
}

// Toggle card known status from stats view
function toggleCardKnownStatus(cardId) {
    const card = cards.find(c => c.id === cardId);
    if (card) {
        card.known = !card.known;
        saveCards();
        updateDashboard();

        // Refresh the stats table with current filter
        const activeFilter = document.querySelector('.filter-btn.active').id;
        let filterType = 'all';
        if (activeFilter === 'availableNowFilter') filterType = 'availableNow';
        if (activeFilter === 'neverPracticedFilter') filterType = 'neverPracticed';
        if (activeFilter === 'knownWordsFilter') filterType = 'knownWords';

        showStatistics(filterType);
    }
}

// Delete card from stats view
function deleteCardFromStats(cardId) {
    const card = cards.find(c => c.id === cardId);
    if (card && confirm(`Are you sure you want to delete the card "${card.word}"?`)) {
        const cardIndex = cards.findIndex(c => c.id === cardId);
        if (cardIndex !== -1) {
            cards.splice(cardIndex, 1);
            saveCards();
            updateDashboard();

            // Refresh the stats table with current filter
            const activeFilter = document.querySelector('.filter-btn.active').id;
            let filterType = 'all';
            if (activeFilter === 'availableNowFilter') filterType = 'availableNow';
            if (activeFilter === 'neverPracticedFilter') filterType = 'neverPracticed';
            if (activeFilter === 'knownWordsFilter') filterType = 'knownWords';

            showStatistics(filterType);
        }
    }
}

// Sort table by column
function sortTable(columnName) {
    const header = document.querySelector(`th[data-sort="${columnName}"]`);
    const currentDirection = header.dataset.sortDirection;

    // Reset all headers
    document.querySelectorAll('th[data-sort]').forEach(h => {
        h.dataset.sortDirection = 'none';
        h.classList.remove('sorted-asc', 'sorted-desc');
    });

    // Set new sort direction
    if (currentDirection === 'none' || currentDirection === 'desc') {
        header.dataset.sortDirection = 'asc';
        header.classList.add('sorted-asc');
    } else {
        header.dataset.sortDirection = 'desc';
        header.classList.add('sorted-desc');
    }

    // Get current filter
    const activeFilter = document.querySelector('.filter-btn.active').id;
    let filterType = 'all';
    if (activeFilter === 'availableNowFilter') filterType = 'availableNow';
    if (activeFilter === 'neverPracticedFilter') filterType = 'neverPracticed';
    if (activeFilter === 'knownWordsFilter') filterType = 'knownWords';

    // Refresh table with sorting
    showStatistics(filterType);
}

// Import cards from file
function importCards(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const content = e.target.result;
        parseAndImport(content);
    };
    reader.readAsText(file);
}

// Parse a content string (from file or pasted textarea) and import cards
function parseAndImport(content) {
    const lines = content.split(/\r?\n/);
    let importedCount = 0;
    let updatedCount = 0;

    lines.forEach(line => {
        // Handle both comma and tab separation
        const parts = line.split(/[,;\t]/).map(s => s.trim());
        if (parts.length < 2) return;

        const word = parts[0];
        const meaning = parts.slice(1).join(', '); // In Case meaning contains commas

        if (word && meaning) {
            // Check if word already exists in current list
            const existingIndex = cards.findIndex(c => c.word === word && c.listId === currentListId);

            if (existingIndex >= 0) {
                // Update existing card
                cards[existingIndex].meaning = meaning;
                updatedCount++;
            } else {
                // Add new card
                cards.push({
                    id: generateId(),
                    word,
                    meaning,
                    practiced: false,
                    known: false,
                    timesShown: 0,
                    correctCount: 0,
                    wrongCount: 0,
                    successRate: 0,
                    lastAskedAt: null,
                    scheduleIndex: 0,
                    nextDueAt: null,
                    listId: currentListId
                });
                importedCount++;
            }
        }
    });

    saveCards();
    updateDashboard();

    document.getElementById('importResult').innerHTML = `
        <div class="feedback correct">
            Import completed!<br>
            ${importedCount} new cards imported<br>
            ${updatedCount} existing cards updated
        </div>
    `;
}

// Add a single card
function addSingleCard() {
    const word = document.getElementById('wordInput').value.trim();
    const meaning = document.getElementById('meaningInput').value.trim();

    if (!word || !meaning) {
        alert('Please enter both word and meaning');
        return;
    }

    // Check if word already exists in current list
    const existingIndex = cards.findIndex(c => c.word === word && c.listId === currentListId);

    if (existingIndex >= 0) {
        // Update existing card
        cards[existingIndex].meaning = meaning;
        alert('Card updated successfully!');
    } else {
        // Add new card
        cards.push({
            id: generateId(),
            word,
            meaning,
            practiced: false,
            known: false,
            timesShown: 0,
            correctCount: 0,
            wrongCount: 0,
            successRate: 0,
            lastAskedAt: null,
            scheduleIndex: 0,
            nextDueAt: null,
            listId: currentListId
        });
        alert('Card added successfully!');
    }

    // Clear inputs
    document.getElementById('wordInput').value = '';
    document.getElementById('meaningInput').value = '';

    saveCards();
    updateDashboard();
}

// Create a new list
function createNewList() {
    const listName = document.getElementById('newListName').value.trim();

    if (!listName) {
        alert('Please enter a list name');
        return;
    }

    const newList = {
        id: generateId(),
        name: listName,
        createdAt: new Date().toISOString()
    };

    lists.push(newList);
    saveLists();

    // Clear input
    document.getElementById('newListName').value = '';

    // Switch to the new list
    currentListId = newList.id;
    localStorage.setItem(CURRENT_LIST_KEY, currentListId);
    loadCards();
    renderLists();
    updateDashboard();

    // close the side nav after creating a list
    closeSideNav();
}

// Wipe all data after confirmation
function wipeAllData() {
    if (confirm('Are you sure you want to delete all cards? This action cannot be undone.')) {
        cards = [];
        saveCards();
        updateDashboard();
        alert('All data has been wiped.');
    }
}

// Export metadata to CSV file
function exportMetadata() {
    // Get all cards from localStorage
    const storedCards = localStorage.getItem(STORAGE_KEY);
    const allCards = storedCards ? JSON.parse(storedCards) : [];

    // Get all lists
    const storedLists = localStorage.getItem(LISTS_STORAGE_KEY);
    const allLists = storedLists ? JSON.parse(storedLists) : [];

    // Get current list ID
    const currentList = localStorage.getItem(CURRENT_LIST_KEY);

    // Create metadata object
    const metadata = {
        version: 1,
        exportDate: new Date().toISOString(),
        currentList: currentList,
        lists: allLists,
        cards: allCards
    };

    // Convert to CSV format
    let csvContent = "type,id,word,meaning,practiced,known,timesShown,correctCount,wrongCount,successRate,lastAskedAt,scheduleIndex,nextDueAt,listId,listName,createdAt\n";

    // Add lists to CSV
    allLists.forEach(list => {
        csvContent += `list,${list.id},${list.name},${list.createdAt || ''}\n`;
    });

    // Add cards to CSV
    allCards.forEach(card => {
        const list = allLists.find(l => l.id === card.listId);
        const listName = list ? list.name : '';

        csvContent += `card,${card.id},${escapeCsvField(card.word)},${escapeCsvField(card.meaning)},${card.practiced},${card.known},${card.timesShown || 0},${card.correctCount || 0},${card.wrongCount || 0},${card.successRate || 0},${card.lastAskedAt || ''},${card.scheduleIndex || 0},${card.nextDueAt || ''},${card.listId},${escapeCsvField(listName)}\n`;
    });

    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);

    link.setAttribute("href", url);
    link.setAttribute("download", `vocabulary-flashcards-backup-${date}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    alert('Metadata exported successfully!');
}

// Helper function to escape CSV fields
function escapeCsvField(field) {
    if (field === null || field === undefined) return '';
    const string = String(field);
    if (string.includes(',') || string.includes('"') || string.includes('\n')) {
        return '"' + string.replace(/"/g, '""') + '"';
    }
    return string;
}

// Import metadata from CSV file
function importMetadata(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const content = e.target.result;
        const lines = content.split('\n');

        let lists = [];
        let cards = [];
        let currentListId = null;

        // Skip header line
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const fields = parseCsvLine(line);

            if (fields[0] === 'list') {
                // Process list
                lists.push({
                    id: fields[1],
                    name: fields[4],
                    createdAt: fields[14] || new Date().toISOString()
                });

                // Check if this is the current list
                if (fields[1] === fields[13]) {
                    currentListId = fields[1];
                }
            } else if (fields[0] === 'card') {
                // Process card
                cards.push({
                    id: fields[1],
                    word: fields[2],
                    meaning: fields[3],
                    practiced: fields[4] === 'true',
                    known: fields[5] === 'true',
                    timesShown: parseInt(fields[6]) || 0,
                    correctCount: parseInt(fields[7]) || 0,
                    wrongCount: parseInt(fields[8]) || 0,
                    successRate: parseFloat(fields[9]) || 0,
                    lastAskedAt: fields[10] || null,
                    scheduleIndex: parseInt(fields[11]) || 0,
                    nextDueAt: fields[12] || null,
                    listId: fields[13]
                });
            }
        }

        if (confirm('Importing metadata will replace your current data. Continue?')) {
            // Save to localStorage
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
            localStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(lists));

            if (currentListId) {
                localStorage.setItem(CURRENT_LIST_KEY, currentListId);
            }

            // Also save to IDB backup
            idbSave(IDB_KEY, { lists, cards, currentListId }).catch(()=>{});

            // Reload the application
            init();
            alert('Metadata imported successfully!');
        }
    };
    reader.readAsText(file);
}

// Helper function to parse CSV line
function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"' && (i === 0 || line[i-1] !== '\\')) {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    result.push(current);
    return result;
}

// Handle metadata import button click
function handleMetadataImport() {
    const input = document.getElementById('metadataFileInput');
    if (!input) return;

    // Ensure it's not disabled and reset value so change fires even if same file chosen twice
    input.value = '';
    // scroll input into view in case some pickers need it (safe because element is off-screen)
    input.focus();
    input.click();
}

// Update language selector based on stored preference
function updateLanguageSelector() {
    const storedLanguage = localStorage.getItem('vocabularyFlashcardsLanguage');
    if (storedLanguage) {
        document.getElementById('languageSelect').value = storedLanguage;
    }

    // Apply translations
    applyTranslations();
}

// Apply translations based on selected language
function applyTranslations() {
    const language = document.getElementById('languageSelect').value;
    // Store preference
    localStorage.setItem('vocabularyFlashcardsLanguage', language);

    // Translation table for the UI strings we need to update
    const texts = {
        en: {
            title: 'Vocabulary Flashcards',
            subtitle: 'Learn and practice vocabulary with spaced repetition',
            learnNewBtn: 'Learn New Words',
            practiceLearnedBtn: 'Practice Learned Words',
            viewStatsBtn: 'View Statistics',
            importBtn: 'Import Cards',
            exportMetadataBtn: 'Export Metadata',
            importMetadataBtn: 'Import Metadata',
            wipeAllBtn: 'Wipe All Data',
            createListBtn: 'Create New List',
            addSingleCardBtn: 'Add Card',
            processImportBtn: 'Process Import',
            backToDashboardBtn: 'Back to Dashboard',
            summaryBtn: 'Back to Dashboard',
            backFromStatsBtn: 'Back to Dashboard',
            backFromImportBtn: 'Back to Dashboard',
            availableNowFilter: 'Available Now',
            neverPracticedFilter: 'Never Practiced',
            knownWordsFilter: 'Known Words',
            allCardsFilter: 'All Cards',
            newListPlaceholder: 'New list name',
            wordPlaceholder: 'Enter word',
            meaningPlaceholder: 'Enter meaning',
            batchSizeLabel: 'Batch Size:',
            directionLabel: 'Direction:',
            addSingleHeader: 'Add Single Card',
            bulkImportHeader: 'Bulk Import',
            yourListsHeader: 'Your Lists',
            deleteListTitle: 'Delete list',
            statsHeaders: {
                word: 'Word',
                meaning: 'Meaning',
                practiced: 'Practiced',
                successRate: 'Success Rate',
                nextDueAt: 'Next Due',
                known: 'Known'
            },
            markKnownBtn: 'Mark as Known',
            markUnknownBtn: 'Mark Unknown',
            deleteCardBtn: 'Delete Card'
        },
        pl: {
            title: 'Fiszki Słownictwa',
            subtitle: 'Ucz się i ćwicz słownictwo z powtórkami spaced',
            learnNewBtn: 'Ucz się nowych słów',
            practiceLearnedBtn: 'Ćwicz opanowane słowa',
            viewStatsBtn: 'Pokaż statystyki',
            importBtn: 'Importuj fiszki',
            exportMetadataBtn: 'Eksportuj metadane',
            importMetadataBtn: 'Importuj metadane',
            wipeAllBtn: 'Usuń wszystkie dane',
            createListBtn: 'Utwórz nową listę',
            addSingleCardBtn: 'Dodaj fiszkę',
            processImportBtn: 'Przetwórz import',
            backToDashboardBtn: 'Powrót do pulpitu',
            summaryBtn: 'Powrót do pulpitu',
            backFromStatsBtn: 'Powrót do pulpitu',
            backFromImportBtn: 'Powrót do pulpitu',
            availableNowFilter: 'Dostępne teraz',
            neverPracticedFilter: 'Nigdy nie ćwicze',
            knownWordsFilter: 'Znane słowa',
            allCardsFilter: 'Wszystkie fiszki',
            newListPlaceholder: 'Nazwa nowej listy',
            wordPlaceholder: 'Wpisz słowo',
            meaningPlaceholder: 'Wpisz znaczenie',
            batchSizeLabel: 'Ilość w partii:',
            directionLabel: 'Kierunek:',
            addSingleHeader: 'Dodaj jedną fiszkę',
            bulkImportHeader: 'Import zbiorczy',
            yourListsHeader: 'Twoje listy',
            deleteListTitle: 'Usuń listę',
            statsHeaders: {
                word: 'Słowo',
                meaning: 'Znaczenie',
                practiced: 'Ćwiczone',
                successRate: 'Skuteczność',
                nextDueAt: 'Następne'
            },
            markKnownBtn: 'Oznacz jako znane',
            markUnknownBtn: 'Oznacz jako nieznane',
            deleteCardBtn: 'Usuń fiszkę'
        },
        tr: {
            title: 'Kelime Kartları',
            subtitle: 'Spaced repetition ile kelime öğrenin ve pratik yapın',
            learnNewBtn: 'Yeni Kelimeler Öğren',
            practiceLearnedBtn: 'Öğrenilenleri Pratik Yap',
            viewStatsBtn: 'İstatistikleri Görüntüle',
            importBtn: 'Kartları İçeri Aktar',
            exportMetadataBtn: 'Metaveriyi Dışa Aktar',
            importMetadataBtn: 'Metaveriyi İçe Aktar',
            wipeAllBtn: 'Tüm Verileri Sil',
            createListBtn: 'Yeni Liste Oluştur',
            addSingleCardBtn: 'Kart Ekle',
            processImportBtn: 'İçe Aktarımı İşle',
            backToDashboardBtn: 'Panoya Dön',
            summaryBtn: 'Panoya Dön',
            backFromStatsBtn: 'Panoya Dön',
            backFromImportBtn: 'Panoya Dön',
            availableNowFilter: 'Şimdi Kullanılabilir',
            neverPracticedFilter: 'Hiç Çalışılmadı',
            knownWordsFilter: 'Bilinen Kelimeler',
            allCardsFilter: 'Tüm Kartlar',
            newListPlaceholder: 'Yeni liste adı',
            wordPlaceholder: 'Kelime girin',
            meaningPlaceholder: 'Anlam girin',
            batchSizeLabel: 'Parti Boyutu:',
            directionLabel: 'Yön:',
            addSingleHeader: 'Tek Kart Ekle',
            bulkImportHeader: 'Toplu İçe Aktarma',
            yourListsHeader: 'Listeleriniz',
            deleteListTitle: 'Listeyi sil',
            statsHeaders: {
                word: 'Kelime',
                meaning: 'Anlam',
                practiced: 'Çalışıldı',
                successRate: 'Başarı Oranı',
                nextDueAt: 'Sonraki',
                known: 'Bilinen'
            },
            markKnownBtn: 'Bilindi Olarak İşaretle',
            markUnknownBtn: 'Bilinmiyor İşaretle',
            deleteCardBtn: 'Kartı Sil'
        }
    };

    const t = texts[language] || texts.en;

    // Titles / headings
    const h1 = document.querySelector('h1');
    if (h1) h1.textContent = t.title;
    const headerP = document.querySelector('header p');
    if (headerP) headerP.textContent = t.subtitle;

    // Buttons
    const setTextIfExists = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    setTextIfExists('learnNewBtn', t.learnNewBtn);
    setTextIfExists('practiceLearnedBtn', t.practiceLearnedBtn);
    setTextIfExists('viewStatsBtn', t.viewStatsBtn);
    setTextIfExists('importBtn', t.importBtn);
    setTextIfExists('exportMetadataBtn', t.exportMetadataBtn);
    setTextIfExists('importMetadataBtn', t.importMetadataBtn);
    // wipeAllBtn is styled with .danger -> keep the class but update label
    setTextIfExists('wipeAllBtn', t.wipeAllBtn);
    setTextIfExists('createListBtn', t.createListBtn);
    setTextIfExists('addSingleCardBtn', t.addSingleCardBtn);
    setTextIfExists('processImportBtn', t.processImportBtn);
    setTextIfExists('backToDashboardBtn', t.backToDashboardBtn);
    setTextIfExists('summaryBtn', t.summaryBtn);
    setTextIfExists('backFromStatsBtn', t.backFromStatsBtn);
    setTextIfExists('backFromImportBtn', t.backFromImportBtn);

    // Filter buttons
    const setFilterText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    setFilterText('availableNowFilter', t.availableNowFilter);
    setFilterText('neverPracticedFilter', t.neverPracticedFilter);
    setFilterText('knownWordsFilter', t.knownWordsFilter);
    setFilterText('allCardsFilter', t.allCardsFilter);

    // Placeholders and labels
    const newListInput = document.getElementById('newListName');
    if (newListInput) newListInput.placeholder = t.newListPlaceholder;

    const wordInput = document.getElementById('wordInput');
    if (wordInput) wordInput.placeholder = t.wordPlaceholder;

    const meaningInput = document.getElementById('meaningInput');
    if (meaningInput) meaningInput.placeholder = t.meaningPlaceholder;

    const batchLabel = document.querySelector('label[for="batchSize"]');
    if (batchLabel) batchLabel.textContent = t.batchSizeLabel;

    const directionLabel = document.querySelector('label[for="direction"]');
    if (directionLabel) directionLabel.textContent = t.directionLabel;

    // Section headers - update side nav header specifically
    const sideNavHeader = document.querySelector('#sideNav h2');
    if (sideNavHeader) sideNavHeader.textContent = t.yourListsHeader;

    const addSingleHeader = document.querySelector('.single-add-form h3');
    if (addSingleHeader) addSingleHeader.textContent = t.addSingleHeader;

    const bulkHeader = document.querySelector('.import-section h3');
    if (bulkHeader) bulkHeader.textContent = t.bulkImportHeader;

    // Stats table headers
    const setTh = (selector, text) => {
        const el = document.querySelector(selector);
        if (el) el.textContent = text;
    };
    setTh('th[data-sort="word"]', t.statsHeaders.word);
    setTh('th[data-sort="meaning"]', t.statsHeaders.meaning);
    setTh('th[data-sort="practiced"]', t.statsHeaders.practiced);
    setTh('th[data-sort="successRate"]', t.statsHeaders.successRate);
    setTh('th[data-sort="nextDueAt"]', t.statsHeaders.nextDueAt);
    setTh('th[data-sort="known"]', t.statsHeaders.known);

    // Update dynamically created delete buttons' title (if any rendered)
    document.querySelectorAll('.delete-list-btn').forEach(btn => {
        btn.title = t.deleteListTitle;
    });

    // Update card action buttons
    const markKnownBtn = document.getElementById('markKnownBtn');
    if (markKnownBtn) {
        markKnownBtn.textContent = t.markKnownBtn;
    }

    const deleteCardBtn = document.getElementById('deleteCardBtn');
    if (deleteCardBtn) {
        deleteCardBtn.textContent = t.deleteCardBtn;
    }
}

// Shuffle array using Fisher-Yates algorithm
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// ===== Side nav open/close: also disable body scroll on open (helps on iOS) =====
function openSideNav() {
    sideNav.classList.add('open');
    overlay.classList.add('show');
    sideNav.setAttribute('aria-hidden', 'false');

    // Prevent background scrolling on mobile when nav open
    document.body.style.overflow = 'hidden';

    // focus the first input for quicker workflow
    const firstInput = sideNav.querySelector('input, button');
    if (firstInput) firstInput.focus();
}

function closeSideNav() {
    sideNav.classList.remove('open');
    overlay.classList.remove('show');
    sideNav.setAttribute('aria-hidden', 'true');

    // Restore body scrolling
    document.body.style.overflow = '';

    // return focus to burger button for accessibility
    if (burgerBtn) burgerBtn.focus();
}

// Toggle
function toggleSideNav() {
    if (sideNav.classList.contains('open')) {
        closeSideNav();
    } else {
        openSideNav();
    }
}

// Set up event listeners
function setupEventListeners() {
    // Dashboard buttons
    document.getElementById('learnNewBtn').addEventListener('click', startLearnSession);
    document.getElementById('practiceLearnedBtn').addEventListener('click', startPracticeSession);
    document.getElementById('viewStatsBtn').addEventListener('click', () => {
        showStatistics('availableNow');
        showView('stats');
    });
    document.getElementById('importBtn').addEventListener('click', () => showView('import'));
    document.getElementById('exportMetadataBtn').addEventListener('click', exportMetadata);
    document.getElementById('importMetadataBtn').addEventListener('click', handleMetadataImport);
    document.getElementById('wipeAllBtn').addEventListener('click', wipeAllData);
    document.getElementById('createListBtn').addEventListener('click', createNewList);

    // File bind / open controls
    const bindBtn = document.getElementById('bindFileBtn');
    if (bindBtn) bindBtn.addEventListener('click', bindFileForAutoSave);
    const openBtn = document.getElementById('openFileBtn');
    if (openBtn) openBtn.addEventListener('click', openAndLoadFromFile);

    // Back buttons
    document.getElementById('backToDashboardBtn').addEventListener('click', () => showView('dashboard'));
    document.getElementById('summaryBtn').addEventListener('click', () => showView('dashboard'));
    document.getElementById('backFromStatsBtn').addEventListener('click', () => showView('dashboard'));
    document.getElementById('backFromImportBtn').addEventListener('click', () => showView('dashboard'));

    // Import functionality (file)
    document.getElementById('processImportBtn').addEventListener('click', () => {
        const fileInput = document.getElementById('fileInput');
        if (fileInput.files.length > 0) {
            importCards(fileInput.files[0]);
        } else {
            alert('Please select a file to import.');
        }
    });

    // NEW: Import pasted content
    document.getElementById('processPasteBtn').addEventListener('click', () => {
        const content = document.getElementById('pasteInput').value;
        if (!content || content.trim() === '') {
            alert('Please paste word,meaning pairs into the text area before importing.');
            return;
        }
        parseAndImport(content);
        // optional: clear textarea after import
        document.getElementById('pasteInput').value = '';
    });

    // Metadata import file change
    document.getElementById('metadataFileInput').addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            importMetadata(e.target.files[0]);
        }
    });

    // Add single card
    document.getElementById('addSingleCardBtn').addEventListener('click', addSingleCard);

    // Statistics filters
    document.getElementById('availableNowFilter').addEventListener('click', () => {
        setActiveFilter('availableNowFilter');
        showStatistics('availableNow');
    });
    document.getElementById('neverPracticedFilter').addEventListener('click', () => {
        setActiveFilter('neverPracticedFilter');
        showStatistics('neverPracticed');
    });
    document.getElementById('knownWordsFilter').addEventListener('click', () => {
        setActiveFilter('knownWordsFilter');
        showStatistics('knownWords');
    });
    document.getElementById('allCardsFilter').addEventListener('click', () => {
        setActiveFilter('allCardsFilter');
        showStatistics('all');
    });

    // Table sorting
    document.querySelectorAll('th[data-sort]').forEach(header => {
        header.addEventListener('click', () => {
            sortTable(header.dataset.sort);
        });
    });

    // Language selection
    document.getElementById('languageSelect').addEventListener('change', applyTranslations);

    // Card actions
    document.getElementById('markKnownBtn').addEventListener('click', markCurrentCardAsKnown);
    document.getElementById('deleteCardBtn').addEventListener('click', deleteCurrentCard);

    // Night mode toggle (added)
    const nightBtn = document.getElementById('nightModeToggle');
    if (nightBtn) {
        nightBtn.addEventListener('click', toggleNightMode);
    }

    // Side nav open/close
    if (burgerBtn) {
        burgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSideNav();
        });
    }
    if (overlay) {
        overlay.addEventListener('click', () => closeSideNav());
    }

    // Close side nav if user clicks Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sideNav.classList.contains('open')) {
            closeSideNav();
        }
    });

    // Prevent clicks inside sideNav from closing it (overlay handles outside)
    sideNav.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

// Set active filter button
function setActiveFilter(activeId) {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(activeId).classList.add('active');
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', init);

/* ============================
   File System + IndexedDB helpers
   ============================ */

// Check FS API support
function isFileSystemAPISupported() {
    return ('showSaveFilePicker' in window) && ('showOpenFilePicker' in window);
}

// Bind (create/select) a file for auto-save
async function bindFileForAutoSave() {
    if (!isFileSystemAPISupported()) {
        alert('File System Access API not supported by this browser. Use Export/Import instead.');
        return;
    }
    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: 'vocabulary-flashcards.json',
            types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
        });
        fileHandle = handle;
        // Try storing file handle in IDB if allowed
        try { await idbSave('file-handle-object', handle); } catch (e) { console.warn('Could not persist file handle'); }
        // Immediately write current data
        await writeDataToBoundFile();
        updateFileStatusUI();
        alert('File bound for auto-save. Your data will be written into that file.');
    } catch (err) {
        console.warn('bindFileForAutoSave cancelled/failed', err);
    }
}

// Write app data to the bound file
async function writeDataToBoundFile() {
    if (!fileHandle) {
        // try to restore from IDB
        try {
            const storedHandle = await idbGet('file-handle-object');
            if (storedHandle) fileHandle = storedHandle;
        } catch (e) {}
    }
    if (!fileHandle) return;

    try {
        const writable = await fileHandle.createWritable();
        const allCards = getAllCardsFromStorage();
        const toSave = {
            lists: lists,
            cards: allCards,
            currentListId: currentListId,
            exportedAt: new Date().toISOString()
        };
        await writable.write(JSON.stringify(toSave, null, 2));
        await writable.close();
        console.log('Saved data to bound file.');
        updateFileStatusUI();
    } catch (err) {
        console.error('Error writing to bound file:', err);
        // if permission revoked, clear handle
        fileHandle = null;
        try { await idbSave('file-handle-object', null); } catch(e){}
        updateFileStatusUI();
    }
}

// Open a file and offer to load data from it
async function openAndLoadFromFile() {
    if (!isFileSystemAPISupported()) {
        alert('File System Access API not supported by this browser.');
        return;
    }
    try {
        const [handle] = await window.showOpenFilePicker({
            types: [{ description: 'JSON', accept: {'application/json': ['.json'] } }],
            multiple: false
        });
        if (!handle) return;
        fileHandle = handle;
        try { await idbSave('file-handle-object', handle); } catch(e){}

        const file = await handle.getFile();
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.cards)) {
            if (!confirm('Load data from this file and replace your current data?')) return;
            // replace storage with file contents
            lists = parsed.lists || lists;
            const allCards = parsed.cards || [];
            localStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(lists));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(allCards));
            if (parsed.currentListId) {
                localStorage.setItem(CURRENT_LIST_KEY, parsed.currentListId);
                currentListId = parsed.currentListId;
            }
            // backup to IDB
            idbSave(IDB_KEY, { lists, cards: allCards, currentListId }).catch(()=>{});
            loadLists();
            loadCards();
            updateDashboard();
            updateFileStatusUI();
            alert('Data loaded from file.');
        } else {
            alert('Selected file does not look like a valid export.');
        }
    } catch (err) {
        console.warn('openAndLoadFromFile cancelled/failed', err);
    }
}

// Helper: return the "all cards" array from localStorage if present, otherwise try IDB or memory
function getAllCardsFromStorage() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
    // try IDB (async is not convenient here) - fall back to memory
    return cards.slice(); // best-effort
}

// Update small UI status about bound file
function updateFileStatusUI() {
    const el = document.getElementById('fileStatus');
    if (!el) return;
    if (!fileHandle) {
        el.textContent = 'No file bound';
    } else {
        el.textContent = `Bound to file (auto-save)`;
    }
}

// =================
// IndexedDB wrappers
// =================
function openIDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_DB_NAME, 1);
        req.onupgradeneeded = (ev) => {
            const db = ev.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbSave(key, value) {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        const r = store.put(value, key);
        r.onsuccess = () => resolve(true);
        r.onerror = () => reject(r.error);
    });
}

async function idbGet(key) {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const r = store.get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}

// Ask for persistent storage (best-effort)
async function requestPersistentStorageIfAvailable() {
    if (navigator.storage && navigator.storage.persist) {
        try {
            const granted = await navigator.storage.persist();
            console.log('Storage persist granted?', granted);
            return granted;
        } catch (err) {
            console.warn('persist() failed', err);
        }
    }
    return false;
}

// Initialize storage enhancements at startup
async function initStorageEnhancements() {
    // try to restore file handle
    try {
        const stored = await idbGet('file-handle-object');
        if (stored) {
            fileHandle = stored;
        }
    } catch (err) {
        // ignore
    }
    // request persistent storage
    await requestPersistentStorageIfAvailable();
}

/* ============================
   End File System + IndexedDB helpers
   ============================ */
