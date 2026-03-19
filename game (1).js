/**
 * 太空边缘 101区 - 核心逻辑引擎
 * 包含：4槽位系统、放置挂机逻辑、DIY装饰、区域迁跃
 */

const CONFIG = {
    BASE_COST: 100,
    GROWTH_RATE: 1.15,
    SAVE_KEY: 'space_edge_save_v1',
    ZONES: {
        safe: { name: "避风港 (安全)", spawnRate: 0, type: 'none' },
        mine: { name: "密集采矿区 (资源)", spawnRate: 0.02, type: 'ore' },
        combat: { name: "敌对星区 (危险)", spawnRate: 0.03, type: 'monster' }
    },
    // DIY 可选装饰列表
    DECORATIONS: [
        { id: 'sticker_1', img: 'sticker_witcher.png', name: '狩魔猎人徽章' },
        { id: 'sticker_2', img: 'sticker_cat.png', name: '招财猫' }
    ]
};

// 初始游戏状态
let state = {
    lc: 0,
    zone: 'safe',
    slots: [null, null, null, null],
    miningLevel: 1,
    weaponLevel: 1,
    isWarping: false,
    diyItems: [] // 存储 {img, x, y}
};

// 全局元素引用
const canvas = document.getElementById('trail-canvas');
const ctx = canvas.getContext('2d');
const objContainer = document.getElementById('object-container');
const diyOverlay = document.getElementById('diy-overlay');

let currentActiveSlot = null;
let lastAutoAttack = 0;

// --- 1. 初始化引擎 ---
function init() {
    canvas.width = 1356;
    canvas.height = 768;
    // === 在这里添加：处理缩放的逻辑 ===
    window.addEventListener('resize', handleResize);
    handleResize();
    
    loadGame();
    renderSlots();
    renderDIY();
    updateUI();
    
    // 启动主循环
    gameLoop();
}

// --- 2. 主游戏循环 (含放置逻辑) ---
function gameLoop(timestamp) {
    if (!state.isWarping && state.zone !== 'safe') {
        // 随机生成逻辑
        if (Math.random() < CONFIG.ZONES[state.zone].spawnRate) {
            spawnObject(CONFIG.ZONES[state.zone].type);
        }

        // 放置类逻辑：自动机枪攻击 (每 1000ms 触发一次)
        if (timestamp - lastAutoAttack > 1000) {
            handleAutoAttack();
            lastAutoAttack = timestamp;
        }
    }
    
    drawTrail();
    requestAnimationFrame(gameLoop);
}

// --- 3. 自动挂机逻辑 (Turret Logic) ---
function handleAutoAttack() {
    // 检查是否有自动机枪装备
    const hasTurret = state.slots.some(s => s && s.key === 'turret');
    if (!hasTurret) return;

    // 寻找最近的一个怪物
    const target = document.querySelector('.game-obj[data-type="monster"]');
    if (target) {
        // 模拟机枪开火视觉反馈（可以在此处加个闪光提示）
        killObject(target);
    }
}

// --- 4. 区域切换与迁跃 ---
function warpTo(zoneKey) {
    if (state.isWarping || state.zone === zoneKey) return;
    state.isWarping = true;
    
    const bg = document.getElementById('bg-layer');
    bg.classList.add('warping');
    objContainer.innerHTML = ''; // 清理战场

    setTimeout(() => {
        state.zone = zoneKey;
        bg.className = 'zone-' + zoneKey;
        bg.classList.remove('warping');
        document.getElementById('zone-name').innerText = CONFIG.ZONES[zoneKey].name;
        
        // 仪表盘灯光反馈
        const led1 = document.getElementById('led-1');
        led1.className = 'led ' + (zoneKey === 'combat' ? 'led-danger' : 'led-active');
        
        state.isWarping = false;
        saveGame();
    }, 2000);
}

// --- 5. 物体生成与交互 ---
function spawnObject(type) {
    const obj = document.createElement('img');
    obj.className = 'game-obj';
    obj.src = type === 'ore' ? 'ore_big.png' : 'monster.png';
    obj.dataset.type = type;
    obj.dataset.hp = type === 'ore' ? 5 : 1;
    
    // 限制在驾驶舱窗户视野内 (中央区域)
    obj.style.left = (400 + Math.random() * 550) + 'px';
    obj.style.top = (200 + Math.random() * 250) + 'px';
    
    objContainer.appendChild(obj);

    if (type === 'ore') {
        obj.onclick = () => useBomb(obj);
    }

    // Racing Comrade! 风格放大效果
    setTimeout(() => { obj.style.transform = `translate(-50%, -50%) scale(2)`; }, 50);
    // 5秒后如果不被击毁则消失
    setTimeout(() => { if(obj.parentNode) obj.remove(); }, 5000);
}

function useBomb(target) {
    const hardness = parseInt(target.dataset.hp);
    if (state.miningLevel >= hardness) {
        target.classList.add('exploding'); // 增加抖动CSS
        setTimeout(() => {
            const rect = target.getBoundingClientRect();
            spawnShards(rect.left + rect.width/2, rect.top + rect.height/2);
            target.remove();
        }, 1000);
    } else {
        console.log("炸弹威力不足！");
    }
}

function spawnShards(x, y) {
    for (let i = 0; i < 6; i++) {
        const shard = document.createElement('img');
        shard.src = 'ore_small.png';
        shard.className = 'game-obj shard';
        shard.style.left = x + 'px';
        shard.style.top = y + 'px';
        objContainer.appendChild(shard);
        
        const tx = (Math.random() - 0.5) * 400;
        const ty = (Math.random() - 0.5) * 400;
        setTimeout(() => {
            shard.style.transform = `translate(${tx}px, ${ty}px) scale(0.5)`;
        }, 50);
    }
}

function killObject(el) {
    el.remove();
    state.lc += 1;
    updateUI();
}

// --- 6. 划动检测 (兼容 PC 缩放与手机触摸) ---
let points = [];
let isSlicing = false;

// 统一的逻辑处理函数
function handleMoveLogic(clientX, clientY) {
    if (!isSlicing) return;

    const rect = canvas.getBoundingClientRect();
    // 核心修复：获取当前 CSS 缩放比例，如果没有定义变量则默认为 1
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--game-scale')) || 1;

    // 将屏幕绝对坐标 转换为 游戏内部坐标 (1356x768 空间)
    const x = (clientX - rect.left) / scale;
    const y = (clientY - rect.top) / scale;

    const p = { x, y };
    points.push(p);
    if (points.length > 8) points.shift();

    // 碰撞检测
    document.querySelectorAll('.game-obj').forEach(t => {
        const r = t.getBoundingClientRect();
        
        // 将怪物的屏幕位置也转换回游戏内部坐标进行比对
        const targetX = (r.left + r.width / 2 - rect.left) / scale;
        const targetY = (r.top + r.height / 2 - rect.top) / scale;
        
        // 计算距离（判定半径随武器等级提升）
        const dist = Math.sqrt(Math.pow(x - targetX, 2) + Math.pow(y - targetY, 2));
        const hitRadius = 40 + (state.weaponLevel * 5); // 基础判定 40 像素

        if (dist < hitRadius) {
            if (t.classList.contains('shard') || t.dataset.type === 'monster') {
                killObject(t);
            }
        }
    });
}

// PC 鼠标事件
canvas.onmousedown = (e) => { isSlicing = true; };
canvas.onmouseup = () => { isSlicing = false; points = []; };
canvas.onmousemove = (e) => {
    handleMoveLogic(e.clientX, e.clientY);
};

// 手机触摸事件 (增加 preventDefault 防止拖动页面)
canvas.ontouchstart = (e) => { 
    isSlicing = true; 
};
canvas.ontouchend = () => { 
    isSlicing = false; points = []; 
};
canvas.ontouchmove = (e) => {
    if (e.touches.length > 0) {
        // 禁止浏览器默认的滑动行为（如刷新或切页）
        e.preventDefault(); 
        handleMoveLogic(e.touches[0].clientX, e.touches[0].clientY);
    }
};
function drawTrail() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (points.length < 2) return;
    ctx.strokeStyle = '#00f2ff';
    ctx.lineWidth = 2 + state.weaponLevel;
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00f2ff';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
}

// --- 7. 装备与升级菜单 ---
const EQUIPMENT_DB = {
    laser: { key: 'laser', name: "激光切裂刀", icon: "⚔️", cost: 100, type: "weapon" },
    bomb: { key: 'bomb', name: "深度采矿炸弹", icon: "💣", cost: 150, type: "mining" },
    turret: { key: 'turret', name: "自动防御机枪", icon: "🔫", cost: 400, type: "weapon" }
};

function openBuildMenu(slotIndex) {
    currentActiveSlot = slotIndex;
    const menu = document.getElementById('build-menu');
    const list = document.getElementById('item-list');
    const current = state.slots[slotIndex];
    
    list.innerHTML = '';
    if (!current) {
        Object.keys(EQUIPMENT_DB).forEach(k => {
            const item = EQUIPMENT_DB[k];
            list.innerHTML += `
                <div class="item-card">
                    <strong>${item.icon} ${item.name}</strong>
                    <button class="btn-buy" onclick="buyItem('${k}')" ${state.lc < item.cost ? 'disabled' : ''}>${item.cost} LC</button>
                </div>`;
        });
    } else {
        const upCost = Math.floor(current.cost * Math.pow(CONFIG.GROWTH_RATE, current.level));
        list.innerHTML = `
            <div class="item-card">
                <strong>${current.icon} ${current.name} (Lv.${current.level})</strong>
                <button class="btn-buy" onclick="upgradeItem()" ${state.lc < upCost ? 'disabled' : ''}>升级: ${upCost} LC</button>
                <button onclick="unequip()">拆卸</button>
            </div>`;
    }
    menu.classList.remove('hidden');
}

function buyItem(key) {
    const item = EQUIPMENT_DB[key];
    if (state.lc >= item.cost) {
        state.lc -= item.cost;
        state.slots[currentActiveSlot] = { ...item, level: 1 };
        applyStats();
        closeMenu();
    }
}

function upgradeItem() {
    const item = state.slots[currentActiveSlot];
    const cost = Math.floor(item.cost * Math.pow(CONFIG.GROWTH_RATE, item.level));
    if (state.lc >= cost) {
        state.lc -= cost;
        item.level++;
        applyStats();
        closeMenu();
    }
}

function unequip() {
    state.slots[currentActiveSlot] = null;
    applyStats();
    closeMenu();
}

function applyStats() {
    // 重新计算全局属性
    state.miningLevel = 1;
    state.weaponLevel = 1;
    state.slots.forEach(s => {
        if (!s) return;
        if (s.type === 'mining') state.miningLevel += s.level;
        if (s.type === 'weapon') state.weaponLevel += s.level;
    });
    updateUI();
    renderSlots();
    saveGame();
}

// --- 8. DIY 装饰系统 (修复移动端拖拽坐标) ---
function renderDIY() {
    diyOverlay.innerHTML = '';
    state.diyItems.forEach((item, index) => {
        const img = document.createElement('img');
        img.src = item.img;
        img.className = 'diy-item';
        img.style.left = item.x + 'px';
        img.style.top = item.y + 'px';
        
        // 兼容 PC 和 手机的拖拽启动
        img.onmousedown = (e) => startDragDIY(e.clientX, e.clientY, index);
        img.ontouchstart = (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            startDragDIY(touch.clientX, touch.clientY, index);
        };
        diyOverlay.appendChild(img);
    });
}

function startDragDIY(startX, startY, index) {
    const item = state.diyItems[index];
    const rect = canvas.getBoundingClientRect();
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--game-scale')) || 1;

    const moveHandler = (clientX, clientY) => {
        // 同样使用 scale 进行坐标转换，确保拖拽时贴纸跟准手指/鼠标
        item.x = (clientX - rect.left) / scale;
        item.y = (clientY - rect.top) / scale;
        renderDIY();
    };

    const onMouseMove = (e) => moveHandler(e.clientX, e.clientY);
    const onTouchMove = (e) => {
        e.preventDefault();
        moveHandler(e.touches[0].clientX, e.touches[0].clientY);
    };

    const stopDrag = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', stopDrag);
        saveGame();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', stopDrag);
}

// --- 9. 辅助系统 ---
function closeMenu() { document.getElementById('build-menu').classList.add('hidden'); }
function toggleMenu(s) { if(!s) closeMenu(); }
function updateUI() { document.getElementById('gold-val').innerText = state.lc; }
function renderSlots() {
    const elSlots = document.querySelectorAll('.slot');
    state.slots.forEach((s, i) => {
        elSlots[i].innerHTML = s ? `${s.icon}<br>Lv.${s.level}` : '空';
    });
}
function saveGame() { localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(state)); }
function loadGame() {
    const saved = localStorage.getItem(CONFIG.SAVE_KEY);
    if (saved) {
        const data = JSON.parse(saved);
        state = { ...state, ...data };
    }
}
// === 在 init 函数外面（比如文件末尾）添加这个新函数 ===
function handleResize() {
    const container = document.getElementById('game-container');
    const scaleX = window.innerWidth / 1356;
    const scaleY = window.innerHeight / 768;
    const scale = Math.min(scaleX, scaleY); // 取最小比例，确保画面完整显示
    document.documentElement.style.setProperty('--game-scale', scale);
}
// 启动！
window.onload = init;