/**
 * 资金雷达工作台 · 技能中心（进阶研究区入口 · 占位页，刀3）
 * 刀3 只挂入口占位；技能（晨报生成/复盘生成/次日清单/异常检测等）由编排器在刀4+ 提供。
 * TODO: 接入真实数据（刀4/测试阶段）—— 技能清单与运行状态届时由 orchestrator 提供。
 */
import { AlertTriangle, BarChart3, ListChecks, Mic, Sunrise, type LucideIcon } from "lucide-react";
import { FR_DISCLAIMER } from "@/data/fundradarSample";

const PLANNED_SKILLS: { icon: LucideIcon; name: string; desc: string }[] = [
  { icon: Sunrise, name: "今日晨报", desc: "08:30 自动生成 · 1 分钟语音朗读" },
  { icon: BarChart3, name: "盘后复盘", desc: "主线 · 游资 · 持仓吻合度" },
  { icon: ListChecks, name: "次日关注清单", desc: "盘后自动生成的方向清单" },
  { icon: AlertTriangle, name: "异常检测", desc: "资金异动哨兵 · 大白话解读" },
  { icon: Mic, name: "语音问答", desc: "SenseVoice 听写 + 系统 TTS 朗读" },
];

export function FundradarSkills() {
  return (
    <div data-fr-page="fundradar-skills" className="p-6">
      <div className="fr-fade-in mx-auto max-w-[1500px]">
        <h1 className="fr-title mb-2 font-bold">技能中心</h1>
        <p className="fr-sub mb-5 text-muted-foreground">
          进阶研究区 · 占位页（刀3）：技能由编排器驱动，将在刀4+ 提供实际运行与开关。
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLANNED_SKILLS.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.name} className="fr-glass rounded-xl p-4">
                <p className="fr-body flex items-center gap-2 font-bold"><Icon className="h-6 w-6 text-primary" aria-hidden="true" />{s.name}</p>
                <p className="fr-sub mt-1 text-muted-foreground">{s.desc}</p>
                <p className="fr-sub mt-2 text-primary">状态：规划中（刀4）</p>
              </div>
            );
          })}
        </div>
        <p className="fr-sub mt-4 text-muted-foreground/80">{FR_DISCLAIMER}</p>
      </div>
    </div>
  );
}
