// 全局配置
const API_BASE = "http://127.0.0.1:12345";
const REFRESH_RATE = 1000; // 1秒刷新
let refreshTimer = null;
let currentUser = 'guest'; // 'guest' or 'admin'

// 枚举映射
const AGV_STATE = {
    0: "空闲", 1: "故障", 2: "前往清理", 3: "前往充电", 4: "清理中", 5: "充电中"
};
const DEVICE_TYPE = { 0: "充电桩", 1: "智能小车" };

// ================== 1. API 封装 ==================
async function apiGet(endpoint) {
    try {
        const res = await fetch(`${API_BASE}/${endpoint}`);
        if (!res.ok) throw new Error("API Error");
        return await res.json();
    } catch (e) {
        console.error("Fetch Error:", e);
        return null;
    }
}

// ================== 2. 初始化与主流程 ==================
document.addEventListener('DOMContentLoaded', () => {
    initUI();
    startRefreshLoop();
});

function initUI() {
    // 绑定导航按钮
    document.getElementById('loginBtn').onclick = () => showModal('loginModal');
    document.getElementById('logoutBtn').onclick = handleLogout;
    
    // 绑定模态框关闭
    document.querySelectorAll('.close').forEach(el => {
        el.onclick = function() { this.closest('.modal').style.display = 'none'; }
    });

    // 登录表单
    document.getElementById('loginForm').onsubmit = handleLogin;
    
    // 默认展示游客界面
    switchRole('guest');
}

function startRefreshLoop() {
    if (refreshTimer) clearInterval(refreshTimer);
    updateMapAndList(); // 立即执行一次
    refreshTimer = setInterval(() => {
        // 如果当前是游客或管理员，且不在查看模态框时，刷新地图
        // 为简单起见，始终刷新位置数据
        updateMapAndList();
        // 如果是管理员且在统计页，刷新统计
        if(currentUser === 'admin' && document.getElementById('stats').style.display !== 'none') {
            loadStats();
        }
    }, REFRESH_RATE);
}

// ================== 3. 游客功能 (地图与列表) ==================



async function updateMapAndList() {
    // 1. 获取所有设备位置
    const positions = await apiGet('getPositions');
    // 获取概要信息 (为了拿到名字)
    const infos = await apiGet('getInfos');
    
    if (!positions || !infos) return;

    // --- 地图渲染开始 ---
    const mapArea = document.getElementById('mapArea');
    
    // 我们用一个数组存一下“查状态”的任务
    const statusChecks = [];

    positions.forEach(pos => {
        let el = document.getElementById(`dev-icon-${pos.No}`);
        if (!el) {
            el = document.createElement('div');
            el.id = `dev-icon-${pos.No}`;
            // 默认先给基础样式
            el.className = `map-icon ${pos.Type === 0 ? 'icon-st' : 'icon-agv'}`;
            el.innerText = pos.Type === 0 ? 'C' : 'A';
            el.onclick = () => showDeviceDetail(pos.Type, pos.No);
            mapArea.appendChild(el);
        }
        
        // 更新位置
        el.style.left = pos.Position.Pos_X + 'px';
        el.style.bottom = pos.Position.Pos_Y + 'px';

        // ★★★ 新增逻辑：如果是小车(Type=1)，去后台查一下它是不是坏了 ★★★
        if (pos.Type === 1) {
            statusChecks.push(checkAndColorAgv(pos.No));
        }
    });

    // 等待所有小车状态检查完毕（并行执行，很快）
    await Promise.all(statusChecks);

    // 移除已消失设备的图标
    const currentIds = positions.map(p => `dev-icon-${p.No}`);
    Array.from(mapArea.children).forEach(child => {
        if (!currentIds.includes(child.id)) mapArea.removeChild(child);
    });
    // --- 地图渲染结束 ---

    // 2. 渲染列表 (仅在游客模式下更新列表)
    if(currentUser === 'guest') {
        const tbody = document.querySelector('#deviceListTable tbody');
        tbody.innerHTML = '';
        infos.forEach(info => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${info.No}</td>
                <td>${DEVICE_TYPE[info.Type]}</td>
                <td><a href="#" onclick="showDeviceDetail(${info.Type}, '${info.No}')">${info.Name}</a></td>
                <td><button onclick="showDeviceDetail(${info.Type}, '${info.No}')">查看详情</button></td>
            `;
            tbody.appendChild(tr);
        });
    }
}

// ★★★ 辅助函数：单独查一辆车的状态并变色 ★★★
async function checkAndColorAgv(no) {
    // 调用获取详情接口
    const detail = await apiGet(`getAGVDetail?no=${no}`);
    const el = document.getElementById(`dev-icon-${no}`);
    
    if (detail && el) {
        // 后台规定：State 为 1 代表故障
        if (detail.State === 1) {
            el.classList.add('status-fault'); // 加上红色样式
        } else {
            el.classList.remove('status-fault'); // 恢复正常样式
        }
    }
}

// 查看详情通用入口
async function showDeviceDetail(type, no) {
    let data;
    if (type === 0) {
        data = await apiGet(`getSTDetail?no=${no}`);
        renderSTDetail(data);
    } else {
        data = await apiGet(`getAGVDetail?no=${no}`);
        renderAGVDetail(data);
    }
}

function renderSTDetail(data) {
    const html = `
        <p><strong>编号:</strong> ${data.No}</p>
        <p><strong>名称:</strong> ${data.Name}</p>
        <p><strong>坐标:</strong> (${data.Pos.Pos_X}, ${data.Pos.Pos_Y})</p>
        <p><strong>使用次数:</strong> ${data.Count}</p>
        <p><strong>状态:</strong> ${data.State === 0 ? '<span style="color:green">空闲</span>' : '<span style="color:blue">使用中</span>'}</p>
        ${data.State === 1 ? `<p><strong>正在充电车辆:</strong> ${data.ChargingAGVNo}</p>` : ''}
    `;
    showModal('detailModal', html, `充电桩详情 - ${data.Name}`);
}

function renderAGVDetail(data) {
    // 状态样式
    const statusText = AGV_STATE[data.State] || "未知";
    const html = `
        <h4>基础信息</h4>
        <p><strong>编号:</strong> ${data.No} &nbsp; <strong>名称:</strong> ${data.Name}</p>
        <hr>
        <h4>参数信息</h4>
        <p>速度: ${data.RunSpeed} | 电池容量: ${data.TotalCapacity} | 充电速度: ${data.ChargeSpeed}</p>
        <hr>
        <h4>实时状态</h4>
        <p><strong>当前状态:</strong> ${statusText}</p>
        <p><strong>当前坐标:</strong> (${data.CurrentPos.Pos_X}, ${data.CurrentPos.Pos_Y})</p>
        <p><strong>目标坐标:</strong> ${data.TargetPos ? `(${data.TargetPos.Pos_X}, ${data.TargetPos.Pos_Y})` : '无'}</p>
        <p><strong>电量:</strong> ${data.CurrentCapacity}/${data.TotalCapacity} 
           <progress value="${data.CurrentCapacity}" max="${data.TotalCapacity}"></progress>
        </p>
        <p><strong>当前任务ID:</strong> ${data.TaskNo === -1 ? '无' : data.TaskNo}</p>
        <p><strong>剩余清理时间:</strong> ${data.CleanTime}秒</p>
    `;
    showModal('detailModal', html, `智能小车详情 - ${data.Name}`);
}

// ================== 4. 管理员功能 ==================

async function handleLogin(e) {
    e.preventDefault();
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    
    // 注意 API 要求参数放在 URL 中
    const res = await apiGet(`login?username=${user}&pwd=${pass}`);
    
    if (res === true) {
        document.getElementById('loginModal').style.display = 'none';
        switchRole('admin');
    } else {
        document.getElementById('loginError').innerText = "登录失败：用户名或密码错误";
    }
}

async function handleLogout() {
    const res = await apiGet(`logout?username=admin`);
    if(res) switchRole('guest');
}

function switchRole(role) {
    currentUser = role;
    const guestSec = document.getElementById('guestSection');
    const adminSec = document.getElementById('adminSection');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userInfo = document.getElementById('currentUserInfo');

    if (role === 'admin') {
        guestSec.style.display = 'none';
        adminSec.style.display = 'block';
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
        userInfo.innerText = "当前角色：管理员";
        switchAdminTab('manageST'); // 默认进第一个tab
    } else {
        guestSec.style.display = 'block';
        adminSec.style.display = 'none';
        loginBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        userInfo.innerText = "当前角色：游客";
    }
}

// Tab 切换
window.switchAdminTab = function(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById(tabId).style.display = 'block';
    // 找到对应按钮高亮 (通过onclick属性简单匹配，实际可用dataset)
    event.target.classList.add('active');

    if (tabId === 'manageST') loadAdminSTList();
    if (tabId === 'manageAGV') loadAdminAGVList();
    if (tabId === 'stats') loadStats();
}

// --- 充电桩管理 ---
async function loadAdminSTList() {
    const infos = await apiGet('getInfos');
    const filter = document.getElementById('filterST').value.toLowerCase();
    const tbody = document.querySelector('#tableST tbody');
    tbody.innerHTML = '';
    
    // getInfos返回混合列表，需过滤
    infos.filter(i => i.Type === 0 && i.Name.toLowerCase().includes(filter)).forEach(item => {
        tbody.innerHTML += `
            <tr>
                <td>${item.No}</td>
                <td>${item.Name}</td>
                <td><button onclick="deleteDevice(0, '${item.No}')" style="color:red">删除</button></td>
            </tr>
        `;
    });
    
    // 绑定筛选事件
    document.getElementById('filterST').oninput = loadAdminSTList;
}

// --- 小车管理 ---
async function loadAdminAGVList() {
    const infos = await apiGet('getInfos');
    const filter = document.getElementById('filterAGV').value.toLowerCase();
    const tbody = document.querySelector('#tableAGV tbody');
    tbody.innerHTML = '';

    // 需要获取详细信息来展示速度和电池? PDF中列表只要求 "以列表展示"，但新增需要输入参数。
    // 为了性能，列表页通常只展示概要。如果必须展示速度，需要对每个车调 getAGVDetail，会很慢。
    // 根据PDF图示，列表只需展示。这里仅展示概要，点击详情可以复用游客的详情弹窗（管理员也能看详情）。
    // *修正*：PDF 2d中说“查看智能小车时，以列表形式展示”。没明确说要展示速度列，只说新增要输。
    // 但为了完善，我们仅展示基本信息，删除功能是重点。
    
    const agvs = infos.filter(i => i.Type === 1 && i.Name.toLowerCase().includes(filter));
    for (let item of agvs) {
        // 如果需要展示速度等，必须在这里await getAGVDetail，可能会卡顿，暂时只展示基础
        tbody.innerHTML += `
            <tr>
                <td>${item.No}</td>
                <td>${item.Name}</td>
                <td>-</td>
                <td>-</td>
                <td>
                    <button onclick="showDeviceDetail(1, '${item.No}')">详情</button>
                    <button onclick="deleteDevice(1, '${item.No}')" style="color:red">删除</button>
                </td>
            </tr>
        `;
    }
    document.getElementById('filterAGV').oninput = loadAdminAGVList;
}

// --- 删除 ---
window.deleteDevice = async function(type, no) {
    if(!confirm(`确定要删除 ${no} 吗?`)) return;
    const endpoint = type === 0 ? `deleteST?no=${no}` : `deleteAGV?no=${no}`;
    const res = await apiGet(endpoint);
    if(res) {
        alert('删除成功');
        type === 0 ? loadAdminSTList() : loadAdminAGVList();
    } else {
        alert('删除失败');
    }
}

// --- 新增模态框 ---
window.openAddSTModal = function() {
    const formHtml = `
        <label>编号(唯一): <input type="text" name="no" required></label><br>
        <label>名称: <input type="text" name="name" required></label><br>
        <label>X坐标: <input type="number" name="x" min="0" max="800" value="0" required></label><br>
        <label>Y坐标: <input type="number" name="y" min="0" max="600" value="0" required></label><br>
        <button type="submit">提交</button>
    `;
    const submitHandler = async (e) => {
        e.preventDefault();
        const f = e.target;
        // API: addST?no=...&name=...&pos_x=...&pos_y=...
        const url = `addST?no=${f.no.value}&name=${f.name.value}&pos_x=${f.x.value}&pos_y=${f.y.value}`;
        const res = await apiGet(url);
        if(res) { alert('添加成功'); document.getElementById('addDeviceModal').style.display='none'; loadAdminSTList(); }
        else alert('添加失败');
    };
    showModal('addDeviceModal', formHtml, '新增充电桩', submitHandler);
}

window.openAddAGVModal = function() {
    const formHtml = `
        <label>编号: <input type="text" name="no" required></label><br>
        <label>名称: <input type="text" name="name" required></label><br>
        <label>运行速度: <input type="number" name="speed" value="10" required></label><br>
        <label>电池容量: <input type="number" name="cap" value="3000" required></label><br>
        <label>充电速度: <input type="number" name="charge" value="100" required></label><br>
        <button type="submit">提交</button>
    `;
    const submitHandler = async (e) => {
        e.preventDefault();
        const f = e.target;
        const url = `addAGV?no=${f.no.value}&name=${f.name.value}&RunSpeed=${f.speed.value}&TotalCapacity=${f.cap.value}&ChargeSpeed=${f.charge.value}`;
        const res = await apiGet(url);
        if(res) { alert('添加成功'); document.getElementById('addDeviceModal').style.display='none'; loadAdminAGVList(); }
        else alert('添加失败');
    };
    showModal('addDeviceModal', formHtml, '新增小车', submitHandler);
}

// ================== 5. 统计功能 ==================
async function loadStats() {
    // 1. 获取任务数据
    const taskStats = await apiGet('getStatistics'); // [{"No":"AGV-01","Count":0}]
    const tasks = await apiGet('getTasks'); // 详细历史
    const infos = await apiGet('getInfos'); // 为了获取AGV列表显示电量

    // 绘制柱状图
    const barChart = document.getElementById('barChart');
    barChart.innerHTML = '';
    // 找出最大值用于比例计算
    const maxCount = Math.max(...taskStats.map(t => t.Count), 10); 
    
    taskStats.forEach(stat => {
        const heightPct = (stat.Count / maxCount) * 100;
        const bar = document.createElement('div');
        bar.className = 'bar-item';
        bar.style.height = `${Math.max(heightPct, 1)}%`; // 至少显示一点高度
        bar.innerHTML = `<span class="bar-value">${stat.Count}</span><span class="bar-label">${stat.No}</span>`;
        barChart.appendChild(bar);
    });

    // 电量进度条
    const batList = document.getElementById('batteryList');
    batList.innerHTML = '';
    // 需要针对每个AGV获取详情才能拿到电量，这里稍微耗时，实际应后端提供批量接口
    // 我们只获取前5个以防卡死，或者基于getInfos过滤后Promise.all
    const agvInfos = infos.filter(i => i.Type === 1);
    for(let info of agvInfos) {
        // 注意：getInfos没有电量，必须调 detail
        const detail = await apiGet(`getAGVDetail?no=${info.No}`);
        const pct = Math.round((detail.CurrentCapacity / detail.TotalCapacity) * 100);
        batList.innerHTML += `
            <div class="progress-wrap">
                <span>${detail.Name} (${detail.No})</span>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width:${pct}%">${pct}%</div>
                </div>
            </div>
        `;
    }

    // 任务详情表 (处理ASP.NET日期格式)
    const taskBody = document.querySelector('#taskTable tbody');
    taskBody.innerHTML = '';
    tasks.forEach(t => {
        const start = parseAspDate(t.Start);
        const end = t.Finish ? parseAspDate(t.Finish) : null;
        const duration = end ? formatDuration(end - start) : "进行中";
        
        taskBody.innerHTML += `
            <tr>
                <td>${t.No}</td>
                <td>${t.AGVNo}</td>
                <td>${formatDate(start)}</td>
                <td>${end ? formatDate(end) : '-'}</td>
                <td>${duration}</td>
            </tr>
        `;
    });
}

// ================== 辅助函数 ==================
function showModal(id, contentHtml = null, title = null, submitHandler = null) {
    const modal = document.getElementById(id);
    modal.style.display = 'block';
    if(title) modal.querySelector('h2').innerText = title;
    
    // 如果是通用弹窗
    if (id === 'detailModal' && contentHtml) {
        document.getElementById('detailBody').innerHTML = contentHtml;
    }
    // 如果是表单弹窗
    if (id === 'addDeviceModal') {
        const form = document.getElementById('addDeviceForm');
        form.innerHTML = contentHtml;
        form.onsubmit = submitHandler;
    }
}

// 解析ASP.NET JSON日期 /Date(175687...)/
function parseAspDate(str) {
    if(!str) return new Date();
    const match = str.match(/\/Date\((\d+)([+-]\d+)?\)\//);
    if(match) return new Date(parseInt(match[1]));
    return new Date();
}

function formatDate(date) {
    return date.toLocaleString();
}

function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h}时${m}分${s}秒`;
}