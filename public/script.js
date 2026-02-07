const socket = io();

// Generate or Retrieve User ID for Reconnection
let userId = localStorage.getItem('guessGameUserId');
if (!userId) {
    userId = 'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('guessGameUserId', userId);
}

// DOM Elements
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const nicknameInput = document.getElementById('nickname-input');
const roomCodeInput = document.getElementById('room-code-input');
const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const displayRoomCode = document.getElementById('display-room-code');
const myRoleSpan = document.getElementById('my-role');
const myNicknameSpan = document.getElementById('my-nickname');
const opponentStatus = document.getElementById('opponent-status');
const gameStatus = document.getElementById('game-status');
const setupArea = document.getElementById('setup-area');
const playArea = document.getElementById('play-area');
const targetInput = document.getElementById('target-input');
const submitTargetBtn = document.getElementById('submit-target-btn');
const turnIndicator = document.getElementById('turn-indicator');
const guessInput = document.getElementById('guess-input');
const submitGuessBtn = document.getElementById('submit-guess-btn');
const historyList = document.getElementById('history-list');
const rulesBtn = document.getElementById('rules-btn');
const rulesModal = document.getElementById('rules-modal');
rulesModal.classList.add('hidden');
const closeModal = document.querySelector('.close-modal');
const resultModal = document.getElementById('result-modal');
// Initialize modals as hidden (double check)
resultModal.classList.add('hidden');
const resultTitle = document.getElementById('result-title');
const resultMessage = document.getElementById('result-message');
const myFinalTarget = document.getElementById('my-final-target');
const opponentFinalTarget = document.getElementById('opponent-final-target');
const modalRestartBtn = document.getElementById('modal-restart-btn');
const modalExitBtn = document.getElementById('modal-exit-btn');
const restartBtn = document.getElementById('restart-btn');
const exitBtn = document.getElementById('exit-btn');
const gameModeSelect = document.getElementById('game-mode');
const statusBar = document.getElementById('status-bar');
const targetsRevealList = document.getElementById('targets-reveal-list');

let currentRoomCode = null;
let myRole = null;
let maxPlayers = 2;

// UI Helpers
function showScreen(screen) {
    lobbyScreen.classList.add('hidden');
    gameScreen.classList.add('hidden');
    screen.classList.remove('hidden');
}

function showModal(modal) {
    modal.classList.remove('hidden');
}

function hideModal(modal) {
    modal.classList.add('hidden');
}

// Input Validation
function validateNumber(input) {
    return /^\d{5}$/.test(input);
}

// Event Listeners
createRoomBtn.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim() || '玩家A';
    const mode = gameModeSelect ? gameModeSelect.value : 2;
    console.log('Creating room with mode:', mode);
    socket.emit('createRoom', { nickname, userId, maxPlayers: mode });
});

joinRoomBtn.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    const roomCode = roomCodeInput.value.trim();
    if (!roomCode) return alert('请输入房间号');
    socket.emit('joinRoom', { roomCode, nickname, userId });
});

submitTargetBtn.addEventListener('click', () => {
    const target = targetInput.value;
    if (!validateNumber(target)) {
        alert('请输入5位纯数字');
        return;
    }
    socket.emit('setTarget', { roomCode: currentRoomCode, target });
    submitTargetBtn.disabled = true;
    targetInput.disabled = true;
    gameStatus.textContent = '已提交目标，等待对方...';
});

submitGuessBtn.addEventListener('click', () => {
    const guess = guessInput.value;
    if (!validateNumber(guess)) {
        alert('请输入5位纯数字');
        return;
    }
    socket.emit('submitGuess', { roomCode: currentRoomCode, guess });
    guessInput.value = '';
});

restartBtn.addEventListener('click', () => {
    socket.emit('restartGame', { roomCode: currentRoomCode });
});

modalRestartBtn.addEventListener('click', () => {
    hideModal(resultModal);
    socket.emit('restartGame', { roomCode: currentRoomCode });
});

exitBtn.addEventListener('click', () => {
    location.reload();
});

modalExitBtn.addEventListener('click', () => {
    location.reload();
});

// Rules Modal
rulesBtn.addEventListener('click', () => showModal(rulesModal));
closeModal.addEventListener('click', () => hideModal(rulesModal));
window.addEventListener('click', (e) => {
    if (e.target === rulesModal) hideModal(rulesModal);
});

// Socket Events
socket.on('roomJoined', (data) => {
    currentRoomCode = data.roomCode;
    myRole = data.role;
    maxPlayers = data.maxPlayers;
    
    showScreen(gameScreen);
    displayRoomCode.textContent = data.roomCode;
    myRoleSpan.textContent = `玩家${data.role}`;
    myRoleSpan.className = `role-badge role-${data.role}`;
    
    document.title = `${maxPlayers}人猜数字 - 房间${data.roomCode}`;
});

socket.on('playerUpdate', (data) => {
    statusBar.innerHTML = '';
    const players = data.players;
    
    const me = players.find(p => p.role === myRole);
    if (me) {
        myNicknameSpan.textContent = me.nickname;
    }

    if (data.count < maxPlayers) {
        gameStatus.textContent = `等待玩家加入 (${data.count}/${maxPlayers})...`;
    }

    players.forEach(p => {
        if (p.role === myRole) return;
        
        const div = document.createElement('div');
        div.className = 'status-item';
        div.innerHTML = `
            <span><span class="role-badge role-${p.role}">${p.role}</span> ${p.nickname}</span>
            <span class="${p.online ? 'status-online' : 'status-offline'}">
                ${p.online ? (p.ready ? '已准备' : '设置中...') : '离线'}
            </span>
        `;
        statusBar.appendChild(div);
    });
});

socket.on('gamePhase', (phase) => {
    if (phase === 'setup') {
        setupArea.classList.remove('hidden');
        playArea.classList.add('hidden');
        gameStatus.textContent = '请设置目标数字';
        // Reset UI if needed
        targetInput.disabled = false;
        targetInput.value = '';
        submitTargetBtn.disabled = false;
        historyList.innerHTML = '';
        hideModal(resultModal);
    } else if (phase === 'playing') {
        setupArea.classList.add('hidden');
        playArea.classList.remove('hidden');
        gameStatus.textContent = '游戏进行中';
    }
});

socket.on('targetSet', (target) => {
    // My target set confirmed
    gameStatus.textContent = '目标已设置，等待游戏开始';
});

socket.on('opponentStatus', (msg) => {
    opponentStatus.textContent = `对方状态: ${msg}`;
});

socket.on('turnChange', (data) => {
    const isMyTurn = data.turnRole === myRole;
    turnIndicator.textContent = `当前回合: ${data.turnNickname} (${data.turnRole})`;
    turnIndicator.style.color = isMyTurn ? 'green' : 'red';
    
    submitGuessBtn.disabled = !isMyTurn;
    guessInput.disabled = !isMyTurn;
    if (isMyTurn) {
        guessInput.focus();
        gameStatus.textContent = '轮到你了，请提问';
    } else {
        gameStatus.textContent = '对方思考中...';
    }
});

socket.on('guessResult', (data) => {
    const item = document.createElement('div');
    item.className = `history-item role-${data.role}`;
    
    let targetText = '';
    if (data.targetRole) {
        targetText = ` <span style="font-size:0.8em; color:#888;">➤ 猜 ${data.targetRole}</span>`;
    }

    item.innerHTML = `
        <div class="history-header">
            <span>${data.nickname} (${data.role})${targetText}</span>
            <span>${new Date().toLocaleTimeString()}</span>
        </div>
        <div class="history-content">
            猜: ${data.guess}
        </div>
        <div class="history-feedback">
            反馈: ${data.feedback}位正确
        </div>
    `;
    historyList.prepend(item);
});

socket.on('gameOver', (data) => {
    showModal(resultModal);
    const isWinner = data.winner === myRole;
    resultTitle.textContent = isWinner ? '恭喜获胜！' : '遗憾落败';
    resultMessage.textContent = `${data.winnerNickname} (${data.winner}) 猜中了目标数字！`;
    
    if (isWinner) {
        launchConfetti();
    }

    targetsRevealList.innerHTML = '';
    for (const [role, target] of Object.entries(data.targets)) {
        const p = document.createElement('p');
        p.innerHTML = `<span class="role-badge role-${role}">${role}</span> 目标: <strong>${target}</strong>`;
        targetsRevealList.appendChild(p);
    }
    
    gameStatus.textContent = '游戏结束';
    submitGuessBtn.disabled = true;
});

// Confetti Animation
function launchConfetti() {
    var duration = 3 * 1000;
    var animationEnd = Date.now() + duration;
    var defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

    function randomInOut(min, max) {
      return Math.random() * (max - min) + min;
    }

    var interval = setInterval(function() {
      var timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      var particleCount = 50 * (timeLeft / duration);
      // since particles fall down, start a bit higher than random
      confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInOut(0.1, 0.3), y: Math.random() - 0.2 } }));
      confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInOut(0.7, 0.9), y: Math.random() - 0.2 } }));
    }, 250);
}

socket.on('gameReset', () => {
    // Reset handled by gamePhase('setup') usually, but let's clear inputs
    targetInput.value = '';
    guessInput.value = '';
    historyList.innerHTML = '';
    hideModal(resultModal);
});

socket.on('playerDisconnected', (data) => {
    // alert(`${data.nickname} 已断开连接`);
    opponentStatus.textContent = '对方状态: 离线 (等待重连...)';
});

socket.on('error', (msg) => {
    alert(msg);
});
