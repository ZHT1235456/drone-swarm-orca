import { Swarm } from '../core/swarm';
import { FORMATIONS, FormationId } from '../core/formations';

/**
 * 左侧任务面板:队形指令、仿真速率、演练操作、导演模式开关。
 */
export class MissionPanel {
  private el: HTMLElement;
  private formationBtns = new Map<FormationId, HTMLButtonElement>();
  private autoCamBtn: HTMLButtonElement;

  constructor(
    root: HTMLElement,
    private swarm: Swarm,
    callbacks: {
      onAutoCamera: (auto: boolean) => void;
    },
  ) {
    this.el = document.createElement('div');
    this.el.id = 'mission-panel';

    const formationHtml = FORMATIONS.map(
      (f) => `<button class="formation-btn" data-id="${f.id}">
        <span style="opacity:.5">▸</span> ${f.nameZh}
      </button>`,
    ).join('');

    this.el.innerHTML = `
      <div class="sidebar-section">
        <div class="section-title"><span>任务规划 MISSION</span><span class="dot"></span></div>
        <div>${formationHtml}</div>
      </div>
      <div class="sidebar-section">
        <div class="section-title"><span>指挥控制 CONTROL</span></div>
        <div class="mission-controls">
          <div class="ctrl-row">
            <label>仿真速率</label>
            <input type="range" id="speed-slider" min="0" max="3" step="0.1" value="1" />
            <span id="speed-label" style="width:34px;text-align:right">1.0x</span>
          </div>
          <div class="ctrl-row">
            <button class="hud-btn toggled" id="auto-cam-btn" style="flex:1">导演运镜:开</button>
          </div>
          <div class="ctrl-row">
            <button class="hud-btn danger" id="inject-btn" style="flex:1">注入单机故障</button>
            <button class="hud-btn" id="recover-btn" style="flex:1">远程复位</button>
          </div>
        </div>
      </div>
    `;
    root.appendChild(this.el);

    this.el.querySelectorAll<HTMLButtonElement>('.formation-btn').forEach((btn) => {
      const id = btn.dataset.id as FormationId;
      this.formationBtns.set(id, btn);
      btn.addEventListener('click', () => {
        this.swarm.setFormation(id);
        this.highlightFormation(id);
      });
    });
    this.highlightFormation(this.swarm.formation);

    const slider = this.el.querySelector<HTMLInputElement>('#speed-slider')!;
    const speedLabel = this.el.querySelector<HTMLElement>('#speed-label')!;
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      this.swarm.timeScale = v;
      speedLabel.textContent = `${v.toFixed(1)}x`;
    });

    this.autoCamBtn = this.el.querySelector<HTMLButtonElement>('#auto-cam-btn')!;
    this.autoCamBtn.addEventListener('click', () => {
      const next = !this.autoCamBtn.classList.contains('toggled');
      this.setAutoCamState(next);
      callbacks.onAutoCamera(next);
    });

    this.el.querySelector('#inject-btn')!.addEventListener('click', () => {
      this.swarm.injectFailure();
    });
    this.el.querySelector('#recover-btn')!.addEventListener('click', () => {
      this.swarm.recoverAll();
    });
  }

  highlightFormation(id: FormationId): void {
    for (const [fid, btn] of this.formationBtns) {
      btn.classList.toggle('active', fid === id);
    }
  }

  setAutoCamState(auto: boolean): void {
    this.autoCamBtn.classList.toggle('toggled', auto);
    this.autoCamBtn.textContent = auto ? '导演运镜:开' : '导演运镜:关';
  }
}
