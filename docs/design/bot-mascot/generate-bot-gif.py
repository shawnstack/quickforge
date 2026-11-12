#!/usr/bin/env python3
"""生成 QuickForge bot 吉祥物动图（圆脸 + 两只简单眼睛）。

流程：逐帧拼 SVG -> rsvg-convert 渲染成透明 PNG -> ffmpeg 合成 GIF。
依赖：rsvg-convert、ffmpeg（均为本机已有工具）。

用法：
    python3 generate-bot-gif.py --all --emit-palette      # 6 个状态 + 调色板网页
    python3 generate-bot-gif.py --all --size 128          # 再出一套小尺寸
    python3 generate-bot-gif.py --state happy --palette grape
    python3 generate-bot-gif.py --all --body "#EF8A3C" --eye "#FFFFFF"
"""

from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

# ---- 造型参数（改这里就能换风格）-------------------------------------------
W = H = 512
BODY_CX, BODY_CY, BODY_R = 256, 296, 138          # 圆身体
EYE_DX, EYE_CY = 48, 300                          # 两只眼睛：左右各偏 48
EYE_RX, EYE_RY = 20, 26
MOUTH_Y = 340
BLUSH_Y, BLUSH_DX = 336, 88
ANTENNA_BEAD = (256, 112)
ANTENNA_STEM = ((256, 176), (256, 124))

BODY_TOP = "#B7D5F2"
BODY_BOTTOM = "#5D86C6"
BODY_RIM = "#3F6BA8"
EYE_COLOR = "#22304A"
BLUSH_COLOR = "#F58CA4"
BEAD_LIGHT = "#FFE9A8"
BEAD_DARK = "#F0B54A"
ANTENNA_COLOR = "#4E7AB8"

FPS = 25
FRAMES = 50  # 25fps * 50 帧 = 2.0 秒一循环


def _bump(t: float, center: float, half: float) -> float:
    """平滑鼓包：t 在 center 处为 1，到 center±half 处衰减为 0。"""
    d = abs(t - center)
    if d >= half:
        return 0.0
    return 0.5 * (1.0 + math.cos(math.pi * d / half))


def build_svg_glow(t: float, size: int) -> str:
    """蓝色渐变版（带天线、腮红、小嘴）。t 为 0..1 的循环进度。"""
    phase = 2.0 * math.pi * t

    # 呼吸：整体轻微纵向起伏，锚点在身体底部，像"一口气"往上撑
    breath = math.sin(phase)
    sx = 1.0 + 0.014 * breath
    sy = 1.0 + 0.030 * breath

    # 眨眼：一个循环眨一次，落在 62% 处，约 0.22 秒
    blink = _bump(t % 1.0, 0.62, 0.055)
    eye_scale = 1.0 - 0.90 * blink

    # 天线光点脉动（GIF 只有二值透明，光晕要给够强度才不会被阈值砍掉）
    glow = 0.5 + 0.5 * math.sin(phase - 0.6)
    glow_op = 0.42 + 0.40 * glow
    glow_r = 19.0 + 8.0 * glow
    bead_r = 12.0 + 1.6 * glow

    eyes = []
    for sign in (-1, 1):
        cx = BODY_CX + sign * EYE_DX
        eyes.append(
            f'<g transform="translate({cx},{EYE_CY}) scale(1,{eye_scale:.4f})">'
            f'<ellipse rx="{EYE_RX}" ry="{EYE_RY}" fill="{EYE_COLOR}"/>'
            f'<circle cx="-7" cy="-9" r="6.5" fill="#FFFFFF" opacity="0.92"/>'
            f'<circle cx="7" cy="8" r="2.6" fill="#FFFFFF" opacity="0.5"/>'
            "</g>"
        )
    blushes = "".join(
        f'<ellipse cx="{BODY_CX + sign * BLUSH_DX}" cy="{BLUSH_Y}" '
        f'rx="20" ry="11" fill="{BLUSH_COLOR}" opacity="0.3"/>'
        for sign in (-1, 1)
    )

    (sx0, sy0), (sx1, sy1) = ANTENNA_STEM
    anchor_y = BODY_CY + BODY_R  # 呼吸的锚点：身体底部

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}"
     viewBox="0 0 {W} {H}">
  <defs>
    <linearGradient id="body" x1="0.22" y1="0.05" x2="0.78" y2="0.98">
      <stop offset="0" stop-color="{BODY_TOP}"/>
      <stop offset="1" stop-color="{BODY_BOTTOM}"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0.33" cy="0.24" r="0.62">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bead" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="{BEAD_LIGHT}"/>
      <stop offset="1" stop-color="{BEAD_DARK}"/>
    </linearGradient>
    <radialGradient id="beadglow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="{BEAD_LIGHT}" stop-opacity="1"/>
      <stop offset="0.5" stop-color="{BEAD_LIGHT}" stop-opacity="0.45"/>
      <stop offset="1" stop-color="{BEAD_LIGHT}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <g transform="translate({BODY_CX},{anchor_y}) scale({sx:.4f},{sy:.4f}) translate({-BODY_CX},{-anchor_y})">
    <circle cx="{ANTENNA_BEAD[0]}" cy="{ANTENNA_BEAD[1]}" r="{glow_r:.2f}"
            fill="url(#beadglow)" opacity="{glow_op:.3f}"/>
    <line x1="{sx0}" y1="{sy0}" x2="{sx1}" y2="{sy1}" stroke="{ANTENNA_COLOR}"
          stroke-width="9" stroke-linecap="round"/>
    <circle cx="{ANTENNA_BEAD[0]}" cy="{ANTENNA_BEAD[1]}" r="{bead_r:.2f}" fill="url(#bead)"/>
    <circle cx="{BODY_CX}" cy="{BODY_CY}" r="{BODY_R}" fill="url(#body)"/>
    <circle cx="{BODY_CX}" cy="{BODY_CY}" r="{BODY_R}" fill="url(#sheen)"/>
    <circle cx="{BODY_CX}" cy="{BODY_CY}" r="{BODY_R - 1.5}" fill="none"
            stroke="{BODY_RIM}" stroke-opacity="0.28" stroke-width="3"/>
    <ellipse cx="{BODY_CX - 52}" cy="{BODY_CY - 56}" rx="42" ry="26"
             transform="rotate(-24 {BODY_CX - 52} {BODY_CY - 56})"
             fill="#FFFFFF" opacity="0.22"/>
    {blushes}
    {"".join(eyes)}
    <path d="M {BODY_CX - 14} {MOUTH_Y} Q {BODY_CX} {MOUTH_Y + 14} {BODY_CX + 14} {MOUTH_Y}"
          fill="none" stroke="{EYE_COLOR}" stroke-opacity="0.72" stroke-width="7"
          stroke-linecap="round"/>
  </g>
</svg>
"""


# ---- 极简版：造型常量 -------------------------------------------------------
# 只有一个实心圆和两只眼睛：没有渐变、高光、描边、天线和嘴。
# 可爱感全靠三件事撑住：正圆轮廓、眼睛的尺寸和位置、动作节奏。
BW_BODY_CX, BW_BODY_CY, BW_BODY_R = 256, 258, 150
BW_EYE_DX, BW_EYE_CY = 46, 262      # 眼睛略低于圆心（婴儿比例，越靠下越幼）；262 是验收时上移后的定稿
BW_EYE_RX, BW_EYE_RY = 18, 32       # 豆豆眼：上下拉长（expressions-preview.html 验收定稿）
BW_ARC = "M -18 6 Q 0 -17 18 6"     # 弯月眼路径
BW_ARC_WIDTH = 11


@dataclass
class Pose:
    """一帧的姿态。状态函数只产出这个，绘制逻辑不认识具体状态。"""

    sx: float = 1.0
    sy: float = 1.0
    dx: float = 0.0         # 整体左右位移，受惊/抖动用
    dy: float = 0.0         # 整体上下位移，跳跃用
    rot: float = 0.0        # 绕身体中心旋转，歪头用
    eye_dx: float = 0.0     # 视线水平位移（眼球转动）
    eye_dy: float = 0.0
    eye_sx: float = 1.0     # 眼睛横向缩放，做"变尖/变圆"
    eye_sy: float = 1.0     # 开合度：1 全开；<1 上眼睑从上往下盖（底边不动）；>1 整体放大
    eye_rot: float = 0.0    # 两眼同向倾斜
    eye_rot2: float = 0.0   # 两眼反向倾斜（对眼、嫌弃）
    eye_spread: float = 0.0  # 两眼间距，正数分开（惊讶）、负数并拢（对焦）
    arc: bool = False       # 弯月眼（开心）


def _eye_shape(pose: Pose) -> tuple[float, float]:
    """返回 (纵向缩放, 额外下移)。

    闭眼时眼睑从上往下盖、底边不动，所以整只眼要跟着往下挪——
    只做整体缩小会变成"眼睛变小"，不像眼皮落下来。睁大时则从中心长。
    """
    if pose.arc or pose.eye_sy >= 1.0:
        return pose.eye_sy, 0.0
    return pose.eye_sy, BW_EYE_RY * (1.0 - pose.eye_sy)

# 缓动表。
# 之前所有通道都走正弦波：匀速、没有起伏、没有停顿，所以整体显得"文静"。
# 换成关键帧 + 缓动后，同一个动作能做出"预备 - 急停 - 过头 - 回弹"的节奏。
EASES = {
    "linear": lambda x: x,
    "in": lambda x: x * x * x,
    "out": lambda x: 1.0 - (1.0 - x) ** 3,
    "inout": lambda x: 4 * x ** 3 if x < 0.5 else 1 - ((-2 * x + 2) ** 3) / 2,
    "snap": lambda x: 1.0 - (1.0 - x) ** 6,          # 极快启动后收住，"啪"的一下
    "back": lambda x: 1 + 2.4 * (x - 1) ** 3 + 1.4 * (x - 1) ** 2,  # 冲过头再回
}


def track(t: float, keys: list[tuple[float, float, str]]) -> float:
    """按关键帧取值。keys = [(时间 0..1, 值, 该段缓动)]，首末值必须相同才能无缝循环。"""
    if t <= keys[0][0]:
        return keys[0][1]
    if t >= keys[-1][0]:
        return keys[-1][1]
    for (t0, v0, ease), (t1, v1, _) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            span = t1 - t0
            if span <= 0:
                return v1
            return v0 + (v1 - v0) * EASES[ease]((t - t0) / span)
    return keys[-1][1]


def pose_idle(t: float) -> Pose:
    """待机：饱满的呼吸——整球上浮 30、横向压到 92% 再鼓回来，像打坐；连眨两下眼。"""
    dy = track(t, [(0.0, 0.0, "inout"), (0.50, -30.0, "inout"), (1.0, 0.0, "inout")])
    sy = track(t, [(0.0, 1.00, "inout"), (0.50, 1.10, "inout"), (1.0, 1.00, "inout")])
    sx = track(t, [(0.0, 1.00, "inout"), (0.50, 0.92, "inout"), (1.0, 1.00, "inout")])
    eye_sy = track(t, [(0.0, 1.0, "linear"), (0.60, 1.0, "snap"), (0.625, 0.06, "out"),
                       (0.68, 1.0, "linear"), (0.80, 1.0, "snap"), (0.825, 0.06, "out"),
                       (0.88, 1.0, "linear"), (1.0, 1.0, "linear")])
    return Pose(sx=sx, sy=sy, dy=dy, eye_sy=eye_sy)


def pose_thinking(t: float) -> Pose:
    """思考：头歪到左边想不通换到右边再想，眼睛来回扫读；结尾「想到啦」压扁弹起。"""
    rot = track(t, [(0.0, 0.0, "out"), (0.12, -14.0, "back"), (0.38, -11.0, "inout"),
                    (0.48, 13.0, "back"), (0.70, 9.0, "inout"), (0.78, 0.0, "out"),
                    (1.0, 0.0, "linear")])
    dy = track(t, [(0.0, 0.0, "out"), (0.12, -8.0, "inout"), (0.38, -5.0, "inout"),
                   (0.48, -9.0, "inout"), (0.70, -6.0, "inout"), (0.78, 0.0, "out"),
                   (0.84, -10.0, "in"), (0.92, 2.0, "out"), (1.0, 0.0, "linear")])
    sy = track(t, [(0.0, 1.00, "out"), (0.78, 1.00, "linear"), (0.84, 0.88, "in"),
                   (0.92, 1.06, "out"), (1.0, 1.00, "linear")])
    sx = track(t, [(0.0, 1.00, "out"), (0.78, 1.00, "linear"), (0.84, 1.12, "in"),
                   (0.92, 0.96, "out"), (1.0, 1.00, "linear")])
    eye_dx = track(t, [(0.0, 0.0, "linear"), (0.16, 30.0, "snap"), (0.40, 8.0, "linear"),
                       (0.46, 32.0, "snap"), (0.68, 0.0, "linear"), (0.84, -10.0, "snap"),
                       (1.0, 0.0, "linear")])
    return Pose(sx=sx, sy=sy, dy=dy, rot=rot, eye_dx=eye_dx)


def pose_working(t: float) -> Pose:
    """干活中：身体前倾 6°，小碎步弹跳——起跳拉长、落地压扁，眼睛盯着手上的活。"""
    rot = track(t, [(0.0, -6.0, "linear"), (1.0, -6.0, "linear")])
    dy = track(t, [(0.0, 0.0, "in"), (0.30, -26.0, "out"), (0.55, 2.0, "in"),
                   (0.80, 0.0, "out"), (1.0, 0.0, "linear")])
    sy = track(t, [(0.0, 1.00, "in"), (0.30, 1.09, "out"), (0.55, 0.86, "out"),
                   (0.80, 1.00, "in"), (1.0, 1.00, "linear")])
    sx = track(t, [(0.0, 1.00, "in"), (0.30, 0.93, "out"), (0.55, 1.14, "out"),
                   (0.80, 1.00, "in"), (1.0, 1.00, "linear")])
    eye_dy = track(t, [(0.0, 9.0, "linear"), (1.0, 9.0, "linear")])
    eye_sy = track(t, [(0.0, 0.92, "linear"), (1.0, 0.92, "linear")])
    return Pose(sx=sx, sy=sy, dy=dy, rot=rot, eye_dy=eye_dy, eye_sy=eye_sy)


def pose_happy(t: float) -> Pose:
    """开心：蓄力下蹲压到 80%，高高弹起，落地压扁到 70% 再小回弹一次；弯月眼。"""
    dy = track(t, [(0.0, 0.0, "in"), (0.14, 18.0, "out"), (0.38, -68.0, "out"),
                   (0.58, 0.0, "in"), (0.66, 10.0, "in"), (0.80, -24.0, "out"),
                   (0.92, 0.0, "out"), (1.0, 0.0, "linear")])
    sy = track(t, [(0.0, 1.00, "in"), (0.14, 0.80, "out"), (0.38, 1.16, "out"),
                   (0.58, 1.00, "in"), (0.66, 0.70, "out"), (0.80, 1.06, "in"),
                   (0.92, 1.00, "out"), (1.0, 1.00, "linear")])
    sx = track(t, [(0.0, 1.00, "in"), (0.14, 1.20, "out"), (0.38, 0.86, "out"),
                   (0.58, 1.00, "in"), (0.66, 1.30, "out"), (0.80, 0.95, "in"),
                   (0.92, 1.00, "out"), (1.0, 1.00, "linear")])
    eye_sy = track(t, [(0.0, 1.0, "in"), (0.14, 0.85, "out"), (0.38, 1.25, "in"),
                       (0.66, 0.80, "out"), (0.80, 1.10, "in"), (0.92, 1.0, "out"),
                       (1.0, 1.0, "linear")])
    return Pose(sx=sx, sy=sy, dy=dy, eye_sy=eye_sy, arc=True)


def pose_sleepy(t: float) -> Pose:
    """犯困：整球塌下去、头一点一点打瞌睡；眼皮合上又挣扎着睁开。"""
    rot = track(t, [(0.0, 0.0, "out"), (0.28, -7.0, "out"), (0.42, -2.0, "inout"),
                    (0.68, -13.0, "in"), (0.86, -4.0, "out"), (1.0, 0.0, "inout")])
    dy = track(t, [(0.0, 0.0, "out"), (0.28, 20.0, "in"), (0.42, 7.0, "out"),
                   (0.68, 30.0, "in"), (0.86, 9.0, "out"), (1.0, 0.0, "inout")])
    sy = track(t, [(0.0, 1.00, "out"), (0.28, 0.90, "in"), (0.42, 0.97, "out"),
                   (0.68, 0.85, "in"), (0.86, 0.96, "out"), (1.0, 1.00, "inout")])
    sx = track(t, [(0.0, 1.00, "out"), (0.28, 1.07, "in"), (0.42, 1.02, "out"),
                   (0.68, 1.12, "in"), (0.86, 1.03, "out"), (1.0, 1.00, "inout")])
    eye_sy = track(t, [(0.0, 1.0, "linear"), (0.18, 1.0, "linear"), (0.52, 0.10, "in"),
                       (0.60, 0.55, "out"), (0.70, 0.08, "in"), (0.88, 0.5, "out"),
                       (0.96, 1.0, "inout"), (1.0, 1.0, "linear")])
    return Pose(sx=sx, sy=sy, dy=dy, rot=rot, eye_sy=eye_sy)


def pose_alert(t: float) -> Pose:
    """提醒：猛地受惊跳起（拉长成 0.8:1.2），落地压扁后左右快速抖两下，瞪大眼定住。"""
    dy = track(t, [(0.0, 0.0, "in"), (0.10, -58.0, "out"), (0.26, 0.0, "in"),
                   (1.0, 0.0, "linear")])
    sy = track(t, [(0.0, 1.00, "in"), (0.10, 1.22, "out"), (0.26, 0.68, "out"),
                   (0.36, 0.94, "inout"), (0.46, 0.94, "inout"), (0.62, 1.00, "out"),
                   (1.0, 1.00, "linear")])
    sx = track(t, [(0.0, 1.00, "in"), (0.10, 0.80, "out"), (0.26, 1.32, "out"),
                   (0.36, 1.06, "inout"), (0.46, 1.06, "inout"), (0.62, 1.00, "out"),
                   (1.0, 1.00, "linear")])
    rot = track(t, [(0.0, 0.0, "linear"), (0.26, 0.0, "linear"), (0.34, -5.0, "out"),
                    (0.44, 5.0, "inout"), (0.54, -3.0, "inout"), (0.62, 0.0, "out"),
                    (1.0, 0.0, "linear")])
    # 落地后的左右横抖（v3 的 translateX ±16）：Pose 没有 dx 时这一下只剩旋转，弱一半
    dx = track(t, [(0.0, 0.0, "linear"), (0.26, 0.0, "linear"), (0.34, -16.0, "out"),
                   (0.44, 16.0, "inout"), (0.54, -9.0, "inout"), (0.62, 0.0, "out"),
                   (1.0, 0.0, "linear")])
    eye_s = track(t, [(0.0, 1.00, "in"), (0.08, 1.00, "linear"), (0.14, 1.30, "out"),
                      (1.0, 1.30, "linear")])
    return Pose(sx=sx, sy=sy, dx=dx, dy=dy, rot=rot, eye_sx=eye_s, eye_sy=eye_s)


def pose_walk(t: float) -> Pose:
    """溜达：一跳一跳地走——起跳拉长、落地压扁、半高回弹，眼睛看着脚下。"""
    dy = track(t, [(0.0, 0.0, "in"), (0.22, -30.0, "out"), (0.48, 2.0, "in"),
                   (0.72, -16.0, "out"), (1.0, 0.0, "in")])
    sy = track(t, [(0.0, 1.00, "in"), (0.22, 1.08, "out"), (0.48, 0.90, "out"),
                   (0.72, 1.05, "out"), (1.0, 1.00, "in")])
    sx = track(t, [(0.0, 1.00, "in"), (0.22, 0.94, "out"), (0.48, 1.10, "out"),
                   (0.72, 0.97, "out"), (1.0, 1.00, "in")])
    eye_dy = track(t, [(0.0, 5.0, "linear"), (1.0, 5.0, "linear")])
    eye_sy = track(t, [(0.0, 0.90, "linear"), (1.0, 0.90, "linear")])
    return Pose(sx=sx, sy=sy, dy=dy, eye_dy=eye_dy, eye_sy=eye_sy)


# 状态 -> (姿态函数, 循环帧数)，按 25fps 换算即循环时长
STATES: dict[str, tuple[object, int]] = {
    "idle": (pose_idle, 40),         # 1.60s —— v3：整球呼吸代替 2% 微动
    "thinking": (pose_thinking, 45),  # 1.80s
    "working": (pose_working, 18),   # 0.72s
    "happy": (pose_happy, 22),       # 0.88s
    "sleepy": (pose_sleepy, 80),     # 3.20s
    "alert": (pose_alert, 28),       # 1.12s
    "walk": (pose_walk, 20),         # 0.80s —— 在输入框顶上溜达时用
}

STATE_LABELS = {
    "idle": ("待机", "整球呼吸：上浮、压扁、鼓回来，连眨两下"),
    "thinking": ("思考", "歪头左右换边想，结尾「想到啦」弹起"),
    "working": ("干活中", "前倾 + 小碎步弹跳，落地压扁"),
    "happy": ("开心", "蓄力下蹲、高高弹起、落地压扁再回弹，弯月眼"),
    "sleepy": ("犯困", "塌下去点头打瞌睡，眼皮合上又挣扎睁开"),
    "alert": ("提醒", "受惊跳起，落地左右抖两下，瞪眼定住"),
    "walk": ("走路", "一跳一跳地走，落地压扁，看着脚下"),
}


PALETTES: dict[str, tuple[str, str]] = {
    "ink": ("#0B0B0C", "#FFFFFF"),
    "inverse": ("#FFFFFF", "#0B0B0C"),
    "indigo": ("#2C3E70", "#FFFFFF"),
    "tangerine": ("#EF8A3C", "#FFFFFF"),
    "mint": ("#57C2A6", "#FFFFFF"),
    "grape": ("#6C4AB6", "#FFFFFF"),
    "butter": ("#F2C94C", "#242424"),
    "slate": ("#4A5568", "#F7FAFC"),
}


def minimal_eye(pose: Pose, sign: int, color: str, cls: str = "") -> str:
    cx = BW_BODY_CX + sign * (BW_EYE_DX + pose.eye_spread) + pose.eye_dx
    cy = BW_EYE_CY + pose.eye_dy
    sy, dy_lid = _eye_shape(pose)
    rot = pose.eye_rot + sign * pose.eye_rot2
    attr = f' class="{cls}"' if cls else ""
    tf = (
        f"translate({cx:.2f},{cy + dy_lid:.2f}) rotate({rot:.3f}) "
        f"scale({pose.eye_sx:.4f},{sy:.4f})"
    )
    if pose.arc:
        return (
            f'<g transform="{tf}"><path{attr} d="{BW_ARC}" fill="none" '
            f'stroke="{color}" stroke-width="{BW_ARC_WIDTH}" stroke-linecap="round"/></g>'
        )
    return (
        f'<g transform="{tf}"><ellipse{attr} rx="{BW_EYE_RX}" ry="{BW_EYE_RY}" '
        f'fill="{color}"/></g>'
    )


def build_svg_minimal(
    t: float,
    size: int,
    state: str = "idle",
    body: str = "#0B0B0C",
    eye: str = "#FFFFFF",
) -> str:
    pose = STATES[state][0](t)
    eyes = "".join(minimal_eye(pose, sign, eye) for sign in (-1, 1))
    anchor_y = BW_BODY_CY + BW_BODY_R

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}"
     viewBox="0 0 {W} {H}">
  <g transform="translate({pose.dx:.2f},{pose.dy:.2f}) rotate({pose.rot:.3f} {BW_BODY_CX} {BW_BODY_CY})
     translate({BW_BODY_CX},{anchor_y}) scale({pose.sx:.4f},{pose.sy:.4f})
     translate({-BW_BODY_CX},{-anchor_y})">
    <circle cx="{BW_BODY_CX}" cy="{BW_BODY_CY}" r="{BW_BODY_R}" fill="{body}"/>
    {eyes}
  </g>
</svg>
"""


def build_svg(
    t: float,
    size: int,
    style: str = "minimal",
    state: str = "idle",
    body: str = "#0B0B0C",
    eye: str = "#FFFFFF",
) -> str:
    if style == "minimal":
        return build_svg_minimal(t, size, state, body, eye)
    return build_svg_glow(t, size)


# ---- 调色板网页 -------------------------------------------------------------
# 网页里的动画不是手写 CSS，而是从同一套姿态函数采样出来的关键帧，
# 所以网页预览和命令行出的 GIF 是同一个动作，颜色改完看到什么就能出什么。

Affine = tuple[float, float, float, float, float, float]


def _mul(m1: Affine, m2: Affine) -> Affine:
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return (
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    )


def _body_matrix(pose: Pose) -> Affine:
    """把 dy / rot / scale 合成成一个 CSS matrix()，与 SVG 里的 transform 链等价。"""
    cx, cy = BW_BODY_CX, BW_BODY_CY
    ay = cy + BW_BODY_R
    rad = math.radians(pose.rot)
    cos_r, sin_r = math.cos(rad), math.sin(rad)
    rot = _mul((1, 0, 0, 1, cx, cy), _mul((cos_r, sin_r, -sin_r, cos_r, 0, 0), (1, 0, 0, 1, -cx, -cy)))
    scl = _mul((1, 0, 0, 1, cx, ay), _mul((pose.sx, 0, 0, pose.sy, 0, 0), (1, 0, 0, 1, -cx, -ay)))
    return _mul(_mul((1, 0, 0, 1, pose.dx, pose.dy), rot), scl)


def _fmt(v: float, nd: int) -> str:
    """格式化；把 -0.00000 这种负零抹平，否则首尾帧比对会假报不一致。"""
    if abs(v) < 0.5 * 10 ** (-nd):
        v = 0.0
    return f"{v:.{nd}f}"


_WEB_BANNER = "/* 由 docs/design/bot-mascot/generate-bot-gif.py --emit-web 生成，勿手改。 */\n\n"


def _emit_state_frames(
    blocks: list[str], rules: list[str], state: str, dur: float,
    fn, wrap, variant: str,
) -> None:
    """采样一个状态的关键帧并写入 rules/blocks。

    variant 为空是原版（512 素材、任意尺寸共用）；"-small" 是小尺寸增强版
    （_enhance：位移/旋转 ×1.35、压扁拉伸偏差 ×1.3），由 data-size='small' 分派。
    """
    body_stops: list[str] = []
    eye_stops: dict[str, list[str]] = {"l": [], "r": []}
    for i in range(51):
        t = i / 50
        pose = wrap(fn(t))
        pct = i * 2
        a, b, c, d, e, f = _body_matrix(pose)
        body_stops.append(
            f"{pct}%{{transform:matrix({_fmt(a, 5)},{_fmt(b, 5)},{_fmt(c, 5)},"
            f"{_fmt(d, 5)},{_fmt(e, 3)},{_fmt(f, 3)})}}"
        )
        sy, dy_lid = _eye_shape(pose)
        for side, sign in (("l", -1), ("r", 1)):
            dx = sign * pose.eye_spread + pose.eye_dx
            rot = pose.eye_rot + sign * pose.eye_rot2
            eye_stops[side].append(
                f"{pct}%{{transform:translate({_fmt(dx, 3)}px,{_fmt(pose.eye_dy + dy_lid, 3)}px) "
                f"rotate({_fmt(rot, 3)}deg) scale({_fmt(pose.eye_sx, 4)},{_fmt(sy, 4)})}}"
            )
    if variant:
        sel = f".qf-mascot[data-state='{state}'][data-size='small']"
    else:
        sel = f".qf-mascot[data-state='{state}']"
    rules.append(
        f"{sel} .qf-mascot__body {{ animation: qf-mascot-body-{state}{variant} {dur:.2f}s linear infinite; }}"
    )
    for side in ("l", "r"):
        rules.append(
            f"{sel} .qf-mascot__eye-{side},\n{sel} .qf-mascot__arc-{side} "
            f"{{ animation: qf-mascot-eye{side.upper()}-{state}{variant} {dur:.2f}s linear infinite; }}"
        )
    rules.append("")
    blocks.append(f"@keyframes qf-mascot-body-{state}{variant}{{{','.join(body_stops)}}}")
    for side in ("l", "r"):
        blocks.append(
            f"@keyframes qf-mascot-eye{side.upper()}-{state}{variant}{{{','.join(eye_stops[side])}}}"
        )


def _keyframes(steps: int = 50) -> str:
    """调色板预览网页用的全套 CSS（与界面同源，重复规则无害）。"""
    return _web_css()


# ---- 界面动画：mascot-v3.html 的手写关键帧，原样照搬 --------------------------
# 界面不再从 pose_* 采样，而是逐字使用设计稿 v3 的 CSS 关键帧和缓动：
# 以球心 (256,258) 为变换原点、整段用 ease-in-out / cubic-bezier 缓动、
# 左右眼共用一套（开心、走路两态眼睛不动）。这样任何尺寸下都和设计稿是同一个动作，
# 只是整体按 size/220 等比缩放；不再有小尺寸「增强版」。
# 注意：GIF（build_svg_minimal / pose_*）仍是旧动作，与界面不完全一致。
# 每项：(循环秒数, 身体缓动, 身体关键帧, 眼睛缓动, 眼睛关键帧或 None)
V3_WEB: dict[str, tuple[float, str, str, str, str | None]] = {
    "idle": (
        1.6, "ease-in-out",
        """  0%        { transform: translateY(0)     scale(1, 1); }
  50%       { transform: translateY(-30px) scale(0.92, 1.10); }
  100%      { transform: translateY(0)     scale(1, 1); }""",
        "linear",
        """  0%, 60%   { transform: scaleY(1); }
  62%       { transform: scaleY(0.06); }
  68%       { transform: scaleY(1); }
  80%       { transform: scaleY(1); }
  82%       { transform: scaleY(0.06); }
  88%,100%  { transform: scaleY(1); }""",
    ),
    "thinking": (
        1.8, "cubic-bezier(.4,0,.2,1)",
        """  0%        { transform: rotate(0)      translateY(0); }
  12%       { transform: rotate(-14deg) translateY(-8px); }
  38%       { transform: rotate(-11deg) translateY(-5px); }
  48%       { transform: rotate(13deg)  translateY(-9px); }
  70%       { transform: rotate(9deg)   translateY(-6px); }
  78%       { transform: rotate(0)      translateY(0) scale(1,1); }
  84%       { transform: rotate(0)      translateY(-10px) scale(1.12, 0.88); }
  92%       { transform: rotate(0)      translateY(2px)  scale(0.96, 1.06); }
  100%      { transform: rotate(0)      translateY(0) scale(1,1); }""",
        "ease-in-out",
        """  0%        { transform: translateX(0); }
  16%       { transform: translateX(30px); }
  40%       { transform: translateX(8px); }
  46%       { transform: translateX(32px); }
  68%       { transform: translateX(0); }
  84%       { transform: translateX(-10px); }
  100%      { transform: translateX(0); }""",
    ),
    "working": (
        0.7, "cubic-bezier(.3,0,.4,1)",
        """  0%        { transform: rotate(-6deg) translateY(0)     scale(1, 1); }
  30%       { transform: rotate(-6deg) translateY(-26px) scale(0.93, 1.09); }
  55%       { transform: rotate(-6deg) translateY(2px)   scale(1.14, 0.86); }
  80%,100%  { transform: rotate(-6deg) translateY(0)     scale(1, 1); }""",
        "linear",
        """  0%,100%   { transform: translateY(9px) scaleY(0.92); }""",
    ),
    "happy": (
        0.9, "cubic-bezier(.3,0,.2,1)",
        """  0%        { transform: translateY(0)    scale(1, 1); }
  14%       { transform: translateY(18px) scale(1.20, 0.80); }
  38%       { transform: translateY(-68px) scale(0.86, 1.16); }
  58%       { transform: translateY(0)    scale(1, 1); }
  66%       { transform: translateY(10px) scale(1.30, 0.70); }
  80%       { transform: translateY(-24px) scale(0.95, 1.06); }
  92%,100%  { transform: translateY(0)    scale(1, 1); }""",
        "linear", None,
    ),
    "sleepy": (
        3.2, "ease-in-out",
        """  0%        { transform: rotate(0)     translateY(0)    scale(1, 1); }
  28%       { transform: rotate(-7deg) translateY(20px) scale(1.07, 0.90); }
  42%       { transform: rotate(-2deg) translateY(7px)  scale(1.02, 0.97); }
  68%       { transform: rotate(-13deg) translateY(30px) scale(1.12, 0.85); }
  86%       { transform: rotate(-4deg) translateY(9px)  scale(1.03, 0.96); }
  100%      { transform: rotate(0)     translateY(0)    scale(1, 1); }""",
        "ease-in-out",
        """  0%, 18%   { transform: scaleY(1); }
  52%       { transform: scaleY(0.10); }
  60%       { transform: scaleY(0.55); }
  70%       { transform: scaleY(0.08); }
  88%       { transform: scaleY(0.5); }
  100%      { transform: scaleY(0.8); }""",
    ),
    "alert": (
        1.1, "cubic-bezier(.2,0,.3,1)",
        """  0%        { transform: translateY(0) scale(1,1); }
  10%       { transform: translateY(-58px) scale(0.80, 1.22); }
  26%       { transform: translateY(0) scale(1.32, 0.68); }
  34%       { transform: translateX(-16px) rotate(-5deg) scale(1.06,0.94); }
  44%       { transform: translateX(16px)  rotate(5deg)  scale(1.06,0.94); }
  54%       { transform: translateX(-9px)  rotate(-3deg); }
  62%       { transform: translateX(0)     rotate(0); }
  100%      { transform: translateY(0) scale(1,1); }""",
        "linear",
        """  0%, 8%    { transform: scale(1); }
  14%, 100% { transform: scale(1.3, 1.35); }""",
    ),
    "walk": (
        0.8, "ease-in-out",
        """  0%        { transform: translateY(0)   scale(1, 1); }
  22%       { transform: translateY(-30px) scale(0.94, 1.08); }
  48%       { transform: translateY(2px) scale(1.10, 0.90); }
  72%       { transform: translateY(-16px) scale(0.97, 1.05); }
  100%      { transform: translateY(0)   scale(1, 1); }""",
        "linear", None,
    ),
}


# ---- 界面互动：hover / poke / dizzy ------------------------------------------
# 设计稿见 interactions-preview.html（已验收）。绑定在 data-interact 上，
# 与状态规则同特异度但写在后面，所以互动期间会盖住状态动画；
# 组件只在 idle / sleepy 且开启动画时置 data-interact（见 use-mascot-interactions.ts）。
# 语义：hover=抬眼看人（悬停期间定住）；hover-exit=0.3s 落回；
#       poke=被戳瘪再弹起（0.6s，播放中的点击只计数不重开）；
#       dizzy=1.6s 内点满 5 下的彩蛋（1.5s，身体左右晃、双眼反向绕圈）。
V3_INTERACT_RULES = """\
/* 互动（hover / poke / dizzy）：只把球本体设为可点，空白处继续穿透 */
.qf-mascot.qf-mascot--interactive { pointer-events: none; }
.qf-mascot.qf-mascot--interactive .qf-mascot__ball { pointer-events: auto; cursor: pointer; }

.qf-mascot[data-interact='hover'] .qf-mascot__body { animation: qf-mascot-body-hover 0.45s ease-out forwards; }
.qf-mascot[data-interact='hover'] .qf-mascot__eye-l,
.qf-mascot[data-interact='hover'] .qf-mascot__eye-r { animation: qf-mascot-eye-hover 0.45s ease-out forwards; }
.qf-mascot[data-interact='hover-exit'] .qf-mascot__body { animation: qf-mascot-body-hover-exit 0.30s ease-in forwards; }
.qf-mascot[data-interact='hover-exit'] .qf-mascot__eye-l,
.qf-mascot[data-interact='hover-exit'] .qf-mascot__eye-r { animation: qf-mascot-eye-hover-exit 0.30s ease-in forwards; }

.qf-mascot[data-interact='poke'] .qf-mascot__body { animation: qf-mascot-body-poke 0.60s cubic-bezier(.3,0,.4,1) 1; }
.qf-mascot[data-interact='poke'] .qf-mascot__eye-l,
.qf-mascot[data-interact='poke'] .qf-mascot__eye-r { animation: qf-mascot-eye-poke 0.60s linear 1; }

.qf-mascot[data-interact='dizzy'] .qf-mascot__body { animation: qf-mascot-body-dizzy 1.50s ease-in-out 1; }
.qf-mascot[data-interact='dizzy'] .qf-mascot__eye-l { animation: qf-mascot-dizzy-eye-l 1.50s linear 1; }
.qf-mascot[data-interact='dizzy'] .qf-mascot__eye-r { animation: qf-mascot-dizzy-eye-r 1.50s linear 1; }"""

V3_INTERACT_KEYFRAMES = """\
@keyframes qf-mascot-body-hover {
  0%        { transform: translateY(0)    scale(1, 1); }
  100%      { transform: translateY(-10px) scale(0.97, 1.04); }
}
@keyframes qf-mascot-eye-hover {
  0%        { transform: translateY(0); }
  100%      { transform: translateY(-10px); }
}
@keyframes qf-mascot-body-hover-exit {
  0%        { transform: translateY(-10px) scale(0.97, 1.04); }
  100%      { transform: translateY(0)    scale(1, 1); }
}
@keyframes qf-mascot-eye-hover-exit {
  0%        { transform: translateY(-10px); }
  100%      { transform: translateY(0); }
}
@keyframes qf-mascot-body-poke {
  0%        { transform: translateY(0)    scale(1, 1); }
  18%       { transform: translateY(14px) scale(1.26, 0.72); }
  34%       { transform: translateY(-34px) scale(0.90, 1.10); }
  48%       { transform: translateY(4px)  scale(1.10, 0.90); }
  62%       { transform: translateY(-12px) scale(0.98, 1.03); }
  78%       { transform: translateY(0)    scale(1, 1); }
  88%       { transform: translateY(3px)  scale(1.04, 0.96); }
  100%      { transform: translateY(0)    scale(1, 1); }
}
@keyframes qf-mascot-eye-poke {
  0%, 14%   { transform: scaleY(1); }
  20%, 44%  { transform: scaleY(0.08); }
  56%       { transform: scaleY(1.15); }
  100%      { transform: scaleY(1); }
}
@keyframes qf-mascot-body-dizzy {
  0%        { transform: rotate(0)     translateY(0)    scale(1, 1); }
  10%       { transform: rotate(-10deg) translateY(4px)  scale(1.06, 0.94); }
  22%       { transform: rotate(12deg) translateY(-6px) scale(0.96, 1.05); }
  34%       { transform: rotate(-13deg) translateY(6px)  scale(1.07, 0.93); }
  46%       { transform: rotate(14deg) translateY(-4px) scale(0.95, 1.05); }
  58%       { transform: rotate(-12deg) translateY(4px)  scale(1.06, 0.94); }
  70%       { transform: rotate(9deg)  translateY(-2px) scale(0.97, 1.03); }
  82%       { transform: rotate(-5deg) translateY(0)    scale(1, 1); }
  100%      { transform: rotate(0)     translateY(0)    scale(1, 1); }
}"""


def _dizzy_eye_keyframes(name: str, sign: float) -> str:
    """转晕的眼睛：半径 8 绕 3 圈（每圈 8 个采样点），末尾眯一下眼再睁开。"""
    stops = []
    for i in range(25):
        angle = sign * i * math.pi / 4.0
        x = 8 * math.cos(angle)
        y = 8 * math.sin(angle)
        if abs(x) < 0.05:
            x = 0.0
        if abs(y) < 0.05:
            y = 0.0
        stops.append(
            f"  {i * 3.0:.1f}%  {{ transform: translate({x:.1f}px, {y:.1f}px) scale(0.9, 0.8); }}"
        )
    stops.append("  86%   { transform: translate(0, 0) scale(1.1, 0.5); }")
    stops.append("  100%  { transform: translate(0, 0) scale(1, 1); }")
    return f"@keyframes {name} {{\n" + "\n".join(stops) + "\n}"


# ---- 界面氛围：待机东张西望（data-ambient='look'）--------------------------
# 设计稿见 expressions-preview.html（已验收）。不由 CSS 无限循环，而是 JS 控制器
# 随机间隔触发（待机 5~9s 一段，见 mascot-interactions.ts），一次性 3.3s：
# 眼睛拉长往左上斜看、停一下，甩到右上停一下，眨眼收尾；球体保持呼吸
# （不动 data-state 的身体动画），通过两个附加图层实现：
#   __tilt：球体反向微歪头（眼看左上时头往右歪）
#   __gaze：双眼整体斜移 + 拉长（平时的眨眼仍由眼睛自己的 idle 动画负责）
# 悬停 / 点击会立即打断（控制器里 stopLook），忙状态不触发。
V3_LOOK_RULES = """\
/* 东张西望（data-ambient='look'）：一次性 3.3s，待机时由 JS 随机间隔触发 */
.qf-mascot__tilt,
.qf-mascot__gaze { transform-box: fill-box; transform-origin: center; }

.qf-mascot[data-ambient='look'] .qf-mascot__tilt { animation: qf-mascot-tilt-look 3.30s ease-in-out 1; }
.qf-mascot[data-ambient='look'] .qf-mascot__gaze { animation: qf-mascot-gaze-look 3.30s ease-in-out 1; }
.qf-mascot[data-ambient='look'] .qf-mascot__sym-quest { display: block; animation: qf-mascot-quest-look 3.30s linear 1; }"""

V3_LOOK_KEYFRAMES = """\
@keyframes qf-mascot-tilt-look {
  0%        { transform: rotate(0); }
  9.1%      { transform: rotate(3.5deg); }   /* 眼往左上，头往右歪（反向） */
  39.4%     { transform: rotate(3.5deg); }
  48.5%     { transform: rotate(-3.5deg); }  /* 眼甩到右上，头往左歪 */
  78.8%     { transform: rotate(-3.5deg); }
  87.9%     { transform: rotate(0); }
  100%      { transform: rotate(0); }
}
@keyframes qf-mascot-gaze-look {
  0%        { transform: translate(0,0) rotate(0) scale(1,1); }
  9.1%      { transform: translate(-15px,-11px) rotate(-8deg) scale(1.05,1.15); }
  39.4%     { transform: translate(-15px,-11px) rotate(-8deg) scale(1.05,1.15); }
  48.5%     { transform: translate(15px,-11px) rotate(8deg) scale(1.05,1.15); }
  78.8%     { transform: translate(15px,-11px) rotate(8deg) scale(1.05,1.15); }
  87.9%     { transform: translate(0,0) rotate(0) scale(1,1); }
  91%, 97%  { transform: translate(0,0) rotate(0) scale(1,0.12); }  /* 眨眼收尾 */
  100%      { transform: translate(0,0) rotate(0) scale(1,1); }
}
@keyframes qf-mascot-quest-look {
  0%, 50%   { opacity: 0; transform: translateY(0) rotate(0); }
  55%       { opacity: 1; transform: translateY(-5px) rotate(-8deg); }
  76%       { opacity: 1; transform: translateY(-5px) rotate(-8deg); }
  80%, 100% { opacity: 0; transform: translateY(0) rotate(0); }
}"""


# ---- 界面状态小符号（qf-mascot__sym-*）--------------------------------------
# 设计稿见 expressions-preview.html（已验收，符号整体再放大一档）。八个：
#   思考 …（三分钟性省略号）／犯困 zZ／提醒 !!／开心 ♡／干活汗滴（球上、眼色）／
#   被戳 !（随 poke）／转晕星星（随 dizzy）／张望 ?（随 look，规则在 V3_LOOK_RULES）。
# 配色规则：球外符号用球身色、球上符号（汗滴）用眼色——深浅主题都与底色拉开。
# 结构规则：定位靠外层 transform 属性，动画作用在里层元素——CSS transform 动画
# 会整个顶掉 transform 属性，同一个元素上两者不能并存（expressions-preview 踩过）。
# 跟着球跳的符号（!! ♡ 汗滴 !）画在 __tilt 里随球动；飘在空中的（… zZ 星星 ?）画在球外。
# 只渲染在开互动的那只上（BotMascot 的 showSymbols），侧栏 / 设置预览不加。
V3_SYMBOL_RULES = """\
/* 状态小符号：默认藏起来，各自的 data 属性到了才显示 */
.qf-mascot__sym { display: none; }
.qf-mascot__sym-z,
.qf-mascot__sym-bang,
.qf-mascot__sym-heart,
.qf-mascot__sym-sweat,
.qf-mascot__sym-poke,
.qf-mascot__sym-quest { transform-box: fill-box; transform-origin: center; }
.qf-mascot__sym-dizzy-orbit { transform-box: view-box; transform-origin: 256px 88px; }

/* 思考 …：一颗一颗加上去（像「正在输入…」），三颗全亮停一拍，一起消散重来
   （1.8s，跟思考同拍；消散正好赶在 84%「想到啦」弹起之前） */
.qf-mascot[data-state='thinking'] .qf-mascot__sym-dots { display: block; }
.qf-mascot[data-state='thinking'] .qf-mascot__sym-dots circle { animation: qf-mascot-sym-dot 1.80s ease-out infinite; }
.qf-mascot[data-state='thinking'] .qf-mascot__sym-dots circle:nth-child(2) { animation-name: qf-mascot-sym-dot-2; }
.qf-mascot[data-state='thinking'] .qf-mascot__sym-dots circle:nth-child(3) { animation-name: qf-mascot-sym-dot-3; }

/* 犯困 zZ：小 z 先起、大 Z 随后，飘着淡出（3.2s，跟犯困同拍） */
.qf-mascot[data-state='sleepy'] .qf-mascot__sym-zz { display: block; }
.qf-mascot[data-state='sleepy'] .qf-mascot__sym-z { animation: qf-mascot-sym-z 3.20s ease-in-out infinite; }
.qf-mascot__sym-zz g:nth-child(2) .qf-mascot__sym-z { animation-delay: .45s; }

/* 提醒 !!：轻浮出、微放大定格（1.1s，跟提醒同拍；画在球体图层里跟着球跳）
   ——评审后柔化：不再弹射+左右抖，跳起的是球，符号只标注情绪 */
.qf-mascot[data-state='alert'] .qf-mascot__sym-bang { display: block; animation: qf-mascot-sym-bang 1.10s ease-out infinite; }

/* 开心 ♡：弹出 + 心跳一下（0.9s，跟开心同拍；跟着球跳） */
.qf-mascot[data-state='happy'] .qf-mascot__sym-heart { display: block; animation: qf-mascot-sym-heart 0.90s ease-out infinite; }

/* 干活汗滴：球上往下滑、淡出（眼色；干活 0.7s 一拍，汗滴两拍一滴） */
.qf-mascot[data-state='working'] .qf-mascot__sym-sweat { display: block; animation: qf-mascot-sym-sweat 1.40s ease-in infinite; }

/* 被戳 !：轻浮出、停住、轻飘走（只在 poke 播放期间出现；forwards 防播完闪回静态）
   ——评审后柔化：去掉弹射和左右晃，戳瘪弹起的动作在球上，符号安静标注即可 */
.qf-mascot[data-interact='poke'] .qf-mascot__sym-poke { display: block; animation: qf-mascot-sym-poke 0.60s ease-out 1 forwards; }

/* 转晕星星：两颗小星绕头顶一圈（只在 dizzy 播放期间出现） */
.qf-mascot[data-interact='dizzy'] .qf-mascot__sym-dizzy { display: block; }
.qf-mascot[data-interact='dizzy'] .qf-mascot__sym-dizzy-orbit { animation: qf-mascot-sym-star-orbit 1.50s linear 1 forwards; }"""

V3_SYMBOL_KEYFRAMES = """\
@keyframes qf-mascot-sym-dot {
  0%        { opacity: 0; transform: translateY(6px); }
  6%        { opacity: 1; transform: translateY(0); }
  78%       { opacity: 1; transform: translateY(0); }
  89%, 100% { opacity: 0; }
}
@keyframes qf-mascot-sym-dot-2 {
  0%, 17%   { opacity: 0; transform: translateY(6px); }
  23%       { opacity: 1; transform: translateY(0); }
  78%       { opacity: 1; transform: translateY(0); }
  89%, 100% { opacity: 0; }
}
@keyframes qf-mascot-sym-dot-3 {
  0%, 33%   { opacity: 0; transform: translateY(6px); }
  39%       { opacity: 1; transform: translateY(0); }
  78%       { opacity: 1; transform: translateY(0); }
  89%, 100% { opacity: 0; }
}
@keyframes qf-mascot-sym-z {
  0%        { opacity: 0; transform: translateY(12px) scale(.8); }
  12%       { opacity: 1; transform: translateY(0) scale(1); }
  62%       { opacity: 1; transform: translateY(-16px); }
  78%       { opacity: 0; transform: translateY(-22px); }
  100%      { opacity: 0; }
}
@keyframes qf-mascot-sym-bang {
  0%        { opacity: 0; transform: translateY(8px) scale(.9); }
  14%       { opacity: 1; transform: translateY(0) scale(1.06); }
  22%       { transform: translateY(0) scale(1); }
  72%       { opacity: 1; }
  88%, 100% { opacity: 0; transform: translateY(-5px); }
}
@keyframes qf-mascot-sym-heart {
  0%        { opacity: 0; transform: scale(0); }
  18%       { opacity: 1; transform: scale(1.25); }
  30%       { transform: scale(1); }
  48%       { transform: scale(1.18); }
  62%       { transform: scale(1); }
  78%       { opacity: 1; transform: translateY(0); }
  92%, 100% { opacity: 0; transform: translateY(-12px); }
}
@keyframes qf-mascot-sym-sweat {
  0%        { opacity: 0; transform: translateY(0); }
  12%       { opacity: 1; }
  55%       { opacity: 1; transform: translateY(46px); }
  68%       { opacity: 0; transform: translateY(52px); }
  100%      { opacity: 0; transform: translateY(0); }
}
@keyframes qf-mascot-sym-poke {
  0%        { opacity: 0; transform: translateY(10px) scale(.92); }
  16%       { opacity: 1; transform: translateY(0) scale(1); }
  70%       { opacity: 1; transform: translateY(0) scale(1); }
  88%       { opacity: 1; }
  100%      { opacity: 0; transform: translateY(-4px); }
}
@keyframes qf-mascot-sym-star-orbit {
  0%        { opacity: 0; transform: rotate(0); }
  8%        { opacity: 1; }
  92%       { opacity: 1; }
  100%      { opacity: 0; transform: rotate(360deg); }
}"""


def _web_css() -> str:
    ink_body, ink_eye = PALETTES["ink"]
    inv_body, inv_eye = PALETTES["inverse"]
    rules = [
        "/* 动作逐字照搬设计稿 mascot-v3.html（见生成脚本 V3_WEB），任何尺寸都是同一个动作 */",
        ".qf-mascot { display: inline-block; overflow: visible; vertical-align: middle; }",
        f".qf-mascot__body {{ transform-box: view-box; transform-origin: {BW_BODY_CX}px {BW_BODY_CY}px; }}",
        ".qf-mascot__part { transform-box: fill-box; transform-origin: center; }",
        "",
        "/* 只有开心用弯月眼，其余状态用椭圆眼 */",
        ".qf-mascot__arc { display: none; }",
        ".qf-mascot[data-state='happy'] .qf-mascot__eye { display: none; }",
        ".qf-mascot[data-state='happy'] .qf-mascot__arc { display: block; }",
        "",
        "/* 默认墨黑配色在深色主题下几乎和背景同色：自动换成反色（白身黑眼） */",
        f".qf-mascot[data-look='default'] {{ --qf-mascot-body: {ink_body}; --qf-mascot-eye: {ink_eye}; }}",
        f".dark .qf-mascot[data-look='default'] {{ --qf-mascot-body: {inv_body}; --qf-mascot-eye: {inv_eye}; }}",
        "",
    ]
    blocks: list[str] = []
    for state, (dur, body_ease, body_kf, eye_ease, eye_kf) in V3_WEB.items():
        sel = f".qf-mascot[data-state='{state}']"
        rules.append(
            f"{sel} .qf-mascot__body {{ animation: qf-mascot-body-{state} {dur:.2f}s {body_ease} infinite; }}"
        )
        blocks.append(f"@keyframes qf-mascot-body-{state} {{\n{body_kf}\n}}")
        if eye_kf is not None:
            rules.append(
                f"{sel} .qf-mascot__eye-l,\n{sel} .qf-mascot__eye-r "
                f"{{ animation: qf-mascot-eye-{state} {dur:.2f}s {eye_ease} infinite; }}"
            )
            blocks.append(f"@keyframes qf-mascot-eye-{state} {{\n{eye_kf}\n}}")
        rules.append("")

    rules.append(V3_INTERACT_RULES)
    rules.append("")
    blocks.append(V3_INTERACT_KEYFRAMES)
    blocks.append(_dizzy_eye_keyframes("qf-mascot-dizzy-eye-l", 1.0))
    blocks.append(_dizzy_eye_keyframes("qf-mascot-dizzy-eye-r", -1.0))

    rules.append(V3_LOOK_RULES)
    rules.append("")
    blocks.append(V3_LOOK_KEYFRAMES)

    rules.append(V3_SYMBOL_RULES)
    rules.append("")
    blocks.append(V3_SYMBOL_KEYFRAMES)

    # 注意：状态规则是 `.qf-mascot[data-state=...] .qf-mascot__body`（0,3,0），
    # 关动画的规则必须更高或加 !important —— 否则「关掉动画」和「减弱动效」
    # 都会输给状态规则，等于开关无效。互动规则同特异度但写在状态之后。
    rules.append("/* 设置里关掉动画、或系统要求减弱动效时：停在初始姿态 */")
    rules.append(
        ".qf-mascot.qf-mascot--static .qf-mascot__body,\n"
        ".qf-mascot.qf-mascot--static .qf-mascot__part,\n"
        ".qf-mascot.qf-mascot--static .qf-mascot__tilt,\n"
        ".qf-mascot.qf-mascot--static .qf-mascot__gaze "
        "{ animation: none !important; transform: none !important; }\n"
        ".qf-mascot.qf-mascot--static .qf-mascot__sym { display: none !important; }"
    )
    rules.append("")
    rules.append("@media (prefers-reduced-motion: reduce) {")
    rules.append(
        "  .qf-mascot[data-state] .qf-mascot__body,\n"
        "  .qf-mascot[data-state] .qf-mascot__part,\n"
        "  .qf-mascot[data-interact] .qf-mascot__body,\n"
        "  .qf-mascot[data-interact] .qf-mascot__part,\n"
        "  .qf-mascot[data-ambient] .qf-mascot__tilt,\n"
        "  .qf-mascot[data-ambient] .qf-mascot__gaze,\n"
        "  .qf-mascot-stroll { animation: none !important; transform: none !important; }\n"
        "  /* 符号只停动画不清 transform（星星等的定位是 transform 属性，清了会飞走） */\n"
        "  .qf-mascot .qf-mascot__sym,\n"
        "  .qf-mascot .qf-mascot__sym * { animation: none !important; }"
    )
    rules.append("}")
    return _WEB_BANNER + "\n".join(rules) + "\n\n" + "\n".join(blocks) + "\n"


def _web_ts() -> str:
    palettes = ",\n".join(
        f"  {{ id: '{name}', body: '{body}', eye: '{eye}' }}" for name, (body, eye) in PALETTES.items()
    )
    durations = ",\n".join(
        f"  {state}: {V3_WEB[state][0]:.2f}" for state in STATES
    )
    labels = "\n".join(f"  {state}: '{label[0]}'," for state, label in STATE_LABELS.items())
    return f"""/** 由 docs/design/bot-mascot/generate-bot-gif.py --emit-web 生成，勿手改。
 *  改造型请改生成脚本后重新导出。 */

export const MASCOT_VIEW_BOX = {W}

export const MASCOT_BODY_SHAPE = {{ cx: {BW_BODY_CX}, cy: {BW_BODY_CY}, r: {BW_BODY_R} }}

export const MASCOT_EYE_SHAPE = {{
  dx: {BW_EYE_DX},
  cy: {BW_EYE_CY},
  rx: {BW_EYE_RX},
  ry: {BW_EYE_RY},
}}

export const MASCOT_ARC = {{ d: '{BW_ARC}', width: {BW_ARC_WIDTH} }}

/** 每个状态的循环时长（秒），与设计稿 mascot-v3.html 一致（GIF 暂未同步）。 */
export const MASCOT_DURATIONS = {{
{durations},
}} as const

export type MascotStateId = keyof typeof MASCOT_DURATIONS

/** 状态的中文名，界面上的 aria-label 用它。 */
export const MASCOT_STATE_LABELS_ZH: Record<MascotStateId, string> = {{
{labels}
}}

export type MascotPalette = {{ id: string; body: string; eye: string }}

export const MASCOT_PALETTES: MascotPalette[] = [
{palettes},
]

export const MASCOT_DEFAULT = {{ body: '{PALETTES["ink"][0]}', eye: '{PALETTES["ink"][1]}', animated: true }}
"""


def _enhance(pose: Pose) -> Pose:
    """小尺寸增强版：位移/旋转放大 1.35，压扁拉伸的偏差放大 1.3，眼睛只放大一点位移。

    512 的素材缩到几十像素后，眼睛的表情（眨眼/弯月/甩眼）物理上不可见，
    活泼感只能靠身体的位移、旋转和形变来撑；眼睛位移放大太多会甩出眼眶。
    """
    return Pose(
        sx=1.0 + (pose.sx - 1.0) * 1.3,
        sy=1.0 + (pose.sy - 1.0) * 1.3,
        dx=pose.dx * 1.35,
        dy=pose.dy * 1.35,
        rot=pose.rot * 1.35,
        eye_dx=pose.eye_dx * 1.1,
        eye_dy=pose.eye_dy * 1.1,
        eye_sx=pose.eye_sx,
        eye_sy=pose.eye_sy,
        eye_rot=pose.eye_rot,
        eye_rot2=pose.eye_rot2,
        eye_spread=pose.eye_spread,
        arc=pose.arc,
    )


def emit_web(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    css_path = out_dir / "mascot-anim.css"
    ts_path = out_dir / "mascot-geometry.ts"
    css_path.write_text(_web_css(), encoding="utf-8", newline="\n")
    ts_path.write_text(_web_ts(), encoding="utf-8", newline="\n")
    print(f"web: {css_path}")
    print(f"web: {ts_path}")

def emit_palette(path: Path) -> None:
    presets = "".join(
        f'<button class="preset" data-body="{b}" data-eye="{e}" title="{name}">'
        f'<i style="background:linear-gradient(135deg,{b} 50%,{e} 50%)"></i>{name}</button>'
        for name, (b, e) in PALETTES.items()
    )
    cards = "".join(_card(state) for state in STATES)
    css = _PALETTE_CSS + _keyframes()
    html = (
        _PALETTE_HTML.replace("__CSS__", css)
        .replace("__CARDS__", cards)
        .replace("__PRESETS__", presets)
        .replace("__JS__", _PALETTE_JS)
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")


def render(
    out_gif: Path,
    size: int,
    fps: int,
    frames: int,
    colors: int = 64,
    dither: str = "none",
    keep_frames: bool = False,
    style: str = "minimal",
    state: str = "idle",
    body: str = "#0B0B0C",
    eye: str = "#FFFFFF",
    still: bool = False,
) -> None:
    rsvg = shutil.which("rsvg-convert")
    ffmpeg = shutil.which("ffmpeg")
    if not rsvg or not ffmpeg:
        raise SystemExit("需要 rsvg-convert 和 ffmpeg")

    tmpdir = Path(tempfile.mkdtemp(prefix="botgif-"))
    try:
        for i in range(frames):
            svg = tmpdir / f"f{i:03d}.svg"
            svg.write_text(build_svg((i + 0.5) / frames, size, style, state, body, eye), encoding="utf-8")
            subprocess.run(
                [rsvg, "-w", str(size), "-h", str(size), "-o", str(tmpdir / f"f{i:03d}.png"), str(svg)],
                check=True,
            )

        subprocess.run(
            [
                ffmpeg, "-y", "-loglevel", "error",
                "-framerate", str(fps), "-i", str(tmpdir / "f%03d.png"),
                "-lavfi",
                "split[a][b];"
                f"[a]palettegen=max_colors={colors}:reserve_transparent=1:stats_mode=full[p];"
                f"[b][p]paletteuse=dither={dither}:alpha_threshold=128",
                "-loop", "0", str(out_gif),
            ],
            check=True,
        )

        # 需要时顺带出一张透明静帧，方便在文档里当 fallback
        if still:
            still_path = out_gif.with_name(out_gif.stem + "-still.png")
            shutil.copy(tmpdir / f"f{frames // 5:03d}.png", still_path)
    finally:
        if keep_frames:
            print(f"frames kept: {tmpdir}")
        else:
            shutil.rmtree(tmpdir, ignore_errors=True)


def main() -> None:
    base = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="生成 bot 吉祥物动图")
    parser.add_argument("--style", choices=("minimal", "glow"), default="minimal")
    parser.add_argument("--state", choices=sorted(STATES), default="idle", help="动作状态")
    parser.add_argument("--all", action="store_true", help="所有状态各出一份")
    parser.add_argument("--palette", choices=sorted(PALETTES), default="ink", help="预设配色")
    parser.add_argument("--body", help="身体颜色，如 #EF8A3C（覆盖 --palette）")
    parser.add_argument("--eye", help="眼睛颜色（覆盖 --palette）")
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--fps", type=int, default=FPS)
    parser.add_argument("--frames", type=int, help="覆盖循环帧数，默认按状态")
    parser.add_argument("--colors", type=int, default=64)
    parser.add_argument("--dither", default="none")
    parser.add_argument("--keep-frames", action="store_true")
    parser.add_argument("--still", action="store_true", help="额外导出透明静帧 PNG")
    parser.add_argument("--out", type=Path, help="输出路径，默认 series/<state>.gif")
    parser.add_argument("--emit-palette", action="store_true", help="同时导出调色板网页 series/palette.html")
    parser.add_argument("--emit-web", action="store_true", help="导出前端要用的 CSS 关键帧与几何数据")
    args = parser.parse_args()

    body, eye = PALETTES[args.palette]
    body = args.body or body
    eye = args.eye or eye

    states = sorted(STATES) if args.all else [args.state]
    if args.out and len(states) > 1:
        raise SystemExit("--all 不能和 --out 一起用")

    for state in states:
        frames = args.frames or STATES[state][1]
        if args.out:
            out = args.out
        elif args.style == "glow":
            out = base / ("bot.gif" if args.size == 512 else f"bot-{args.size}.gif")
        else:
            suffix = "" if args.size == 512 else f"-{args.size}"
            out = base / "series" / f"{state}{suffix}.gif"
        out.parent.mkdir(parents=True, exist_ok=True)
        render(
            out,
            args.size,
            args.fps,
            frames,
            colors=args.colors,
            dither=args.dither,
            keep_frames=args.keep_frames,
            style=args.style,
            state=state,
            body=body,
            eye=eye,
            still=args.still,
        )
        print(f"done: {out}  ({state}, {frames} 帧 / {frames / args.fps:.2f}s, 身体 {body}, 眼睛 {eye})")

    if args.emit_web:
        emit_web(base.parents[2] / "src" / "components" / "bots" / "mascot")

    if args.emit_palette:
        palette_html = base / "series" / "palette.html"
        emit_palette(palette_html)
        print(f"done: {palette_html}  (调色板网页)")


if __name__ == "__main__":
    main()
