import { Renderer, Program, Mesh, Color, Triangle } from 'ogl'
import { useEffect, useRef, CSSProperties } from 'react'

const MAX_STRANDS = 12
const MAX_COLORS = 8

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColors[${MAX_COLORS}];
uniform int uColorCount;
uniform int uStrandCount;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaviness;
uniform float uThickness;
uniform float uGlow;
uniform float uTaper;
uniform float uSpread;
uniform float uHueShift;
uniform float uIntensity;
uniform float uOpacity;
uniform float uScale;
uniform float uSaturation;

out vec4 fragColor;

const float PI = 3.14159265;

vec3 spectrum(float t) {
  return 0.5 + 0.5 * cos(2.0 * PI * (t + vec3(0.00, 0.33, 0.67)));
}

vec3 samplePalette(float t) {
  t = fract(t);
  float scaled = t * float(uColorCount);
  int idx = int(floor(scaled));
  float blend = fract(scaled);
  int nextIdx = idx + 1;
  if (nextIdx >= uColorCount) nextIdx = 0;
  return mix(uColors[idx], uColors[nextIdx], blend);
}

vec3 strandColor(float t) {
  if (uColorCount > 0) return samplePalette(t);
  return spectrum(t);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  uv /= max(uScale, 0.0001);

  float e = 0.06 + uIntensity * 0.94;
  float env = pow(max(cos(uv.x * PI * 1.3), 0.0), uTaper);

  vec3 col = vec3(0.0);

  for (int i = 0; i < ${MAX_STRANDS}; i++) {
    if (i >= uStrandCount) break;

    float fi = float(i);
    float ph = fi * 1.7 * uSpread;
    float freq = (2.0 + fi * 0.35) * uWaviness;
    float spd = 1.4 + fi * 1.2;

    float tt = uTime * uSpeed;
    float w = sin(uv.x * freq + tt * spd + ph) * 0.60
            + sin(uv.x * freq * 1.1 - tt * spd * 0.7 + ph * 1.7) * 0.40;

    float amp = (0.1 + 0.02 * e) * env * uAmplitude;
    float y = w * amp;

    float d = abs(uv.y - y);
    float thick = (0.001 + 0.05 * e) * (0.35 + env) * uThickness;
    float g = thick / (d + thick * 0.45);
    g = g * g;

    float h = fi / float(uStrandCount) + uv.x * 0.30 + uTime * 0.04 + uHueShift;
    col += strandColor(h) * g * env;
  }

  col *= 0.45 + 0.7 * e;
  col = 1.0 - exp(-col * uGlow);

  float gray = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(gray), col, uSaturation), 0.0);

  float lum = max(max(col.r, col.g), col.b);
  float alpha = clamp(lum, 0.0, 1.0) * uOpacity;

  fragColor = vec4(col * uOpacity, alpha);
}
`

export interface StrandsAnimationProps {
  colors?: string[]
  count?: number
  speed?: number
  amplitude?: number
  waviness?: number
  thickness?: number
  glow?: number
  taper?: number
  spread?: number
  hueShift?: number
  intensity?: number
  saturation?: number
  opacity?: number
  scale?: number
  style?: CSSProperties
}

const buildPalette = (colors: string[]): number[][] => {
  const filled = colors && colors.length ? colors : ['#FF4242', '#7C3AED', '#06B6D4', '#EAB308']
  const padded: number[][] = []
  for (let i = 0; i < MAX_COLORS; i++) {
    const hex = filled[i] ?? filled[filled.length - 1]
    const c = new Color(hex)
    padded.push([c.r, c.g, c.b])
  }
  return padded
}

export default function StrandsAnimation({
  colors = ['#FF4242', '#7C3AED', '#06B6D4', '#EAB308'],
  count = 3,
  speed = 0.3,
  amplitude = 0.7,
  waviness = 1,
  thickness = 0.7,
  glow = 2.2,
  taper = 3,
  spread = 1,
  hueShift = 0,
  intensity = 0.5,
  saturation = 1.5,
  opacity = 0.9,
  scale = 1.5,
  style
}: StrandsAnimationProps) {
  const ctnDom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctn = ctnDom.current
    if (!ctn) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const renderer = new Renderer({
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      dpr
    })
    const gl = renderer.gl
    gl.clearColor(0, 0, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.canvas.style.backgroundColor = 'transparent'

    const geometry = new Triangle(gl)
    if (geometry.attributes.uv) {
      delete geometry.attributes.uv
    }

    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [ctn.offsetWidth, ctn.offsetHeight] },
        uColors: { value: buildPalette(colors) },
        uColorCount: { value: Math.min(colors.length, MAX_COLORS) },
        uStrandCount: { value: Math.min(count, MAX_STRANDS) },
        uSpeed: { value: speed },
        uAmplitude: { value: amplitude },
        uWaviness: { value: waviness },
        uThickness: { value: thickness },
        uGlow: { value: glow },
        uTaper: { value: taper },
        uSpread: { value: spread },
        uHueShift: { value: hueShift },
        uIntensity: { value: intensity },
        uOpacity: { value: opacity },
        uScale: { value: scale },
        uSaturation: { value: saturation }
      }
    })

    const mesh = new Mesh(gl, { geometry, program })

    ctn.appendChild(gl.canvas)
    gl.canvas.style.pointerEvents = 'none'

    function resize(): void {
      if (!ctn) return
      const width = ctn.offsetWidth
      const height = ctn.offsetHeight
      renderer.setSize(width, height)
      program.uniforms.uResolution.value = [width * dpr, height * dpr]
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(ctn)

    let animateId = 0
    const update = (t: number): void => {
      animateId = requestAnimationFrame(update)
      program.uniforms.uTime.value = t * 0.001
      renderer.render({ scene: mesh })
    }
    animateId = requestAnimationFrame(update)

    return () => {
      cancelAnimationFrame(animateId)
      resizeObserver.disconnect()
      if (ctn && gl.canvas.parentNode === ctn) {
        ctn.removeChild(gl.canvas)
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={ctnDom}
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
        ...style
      }}
    />
  )
}
