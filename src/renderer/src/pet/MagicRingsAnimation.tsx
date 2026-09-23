import { useEffect, useRef, CSSProperties } from 'react'
import * as THREE from 'three'

const vertexShader = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = `
precision highp float;

uniform float uTime, uAttenuation, uLineThickness;
uniform float uBaseRadius, uRadiusStep, uScaleRate;
uniform float uOpacity, uNoiseAmount, uRotation, uRingGap;
uniform float uFadeIn, uFadeOut;
uniform float uBurst;
uniform vec2 uResolution;
uniform vec3 uColor, uColorTwo;
uniform int uRingCount;

const float HP = 1.5707963;
const float CYCLE = 3.45;

float fade(float t) {
  return t < uFadeIn ? smoothstep(0.0, uFadeIn, t) : 1.0 - smoothstep(uFadeOut, CYCLE - 0.2, t);
}

float ring(vec2 p, float ri, float cut, float t0, float px) {
  float t = mod(uTime + t0, CYCLE);
  float r = ri + t / CYCLE * uScaleRate;
  float d = abs(length(p) - r);
  float a = atan(abs(p.y), abs(p.x)) / HP;
  float th = max(1.0 - a, 0.5) * px * uLineThickness;
  float h = (1.0 - smoothstep(th, th * 1.5, d)) + 1.0;
  d += pow(cut * a, 3.0) * r;
  return h * exp(-uAttenuation * d) * fade(t);
}

void main() {
  float px = 1.0 / min(uResolution.x, uResolution.y);
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) * px;
  float cr = cos(uRotation), sr = sin(uRotation);
  p = mat2(cr, -sr, sr, cr) * p;
  vec3 c = vec3(0.0);
  float rcf = max(float(uRingCount) - 1.0, 1.0);
  for (int i = 0; i < 10; i++) {
    if (i >= uRingCount) break;
    float fi = float(i);
    vec3 rc = mix(uColor, uColorTwo, fi / rcf);
    c = mix(c, rc, vec3(ring(p, uBaseRadius + fi * uRadiusStep, pow(uRingGap, fi), i == 0 ? 0.0 : 2.95 * fi, px)));
  }
  c *= 1.0 + uBurst * 2.0;
  float n = fract(sin(dot(gl_FragCoord.xy + uTime * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * uNoiseAmount;
  gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)) * uOpacity);
}
`

export interface MagicRingsAnimationProps {
  color?: string
  colorTwo?: string
  speed?: number
  ringCount?: number
  opacity?: number
  lineThickness?: number
  baseRadius?: number
  radiusStep?: number
  scaleRate?: number
  rotation?: number
  ringGap?: number
  attenuation?: number
  noiseAmount?: number
  clickBurst?: boolean
  style?: CSSProperties
}

export default function MagicRingsAnimation({
  color = '#fc42ff',
  colorTwo = '#42fcff',
  speed = 0.8,
  ringCount = 6,
  opacity = 0.85,
  lineThickness = 2,
  baseRadius = 0.3,
  radiusStep = 0.08,
  scaleRate = 0.08,
  rotation = 0.3,
  ringGap = 0.4,
  attenuation = 10,
  noiseAmount = 0.05,
  clickBurst = false,
  style
}: MagicRingsAnimationProps) {
  const ctnRef = useRef<HTMLDivElement>(null)
  const burstRef = useRef(0)

  useEffect(() => {
    const container = ctnRef.current
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      premultipliedAlpha: true,
      antialias: true
    })
    renderer.setSize(width, height)
    renderer.setPixelRatio(dpr)
    renderer.domElement.style.backgroundColor = 'transparent'

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.z = 1

    const uniforms = {
      uTime: { value: 0 },
      uAttenuation: { value: attenuation },
      uLineThickness: { value: lineThickness },
      uBaseRadius: { value: baseRadius },
      uRadiusStep: { value: radiusStep },
      uScaleRate: { value: scaleRate },
      uOpacity: { value: opacity },
      uNoiseAmount: { value: noiseAmount },
      uRotation: { value: rotation },
      uRingGap: { value: ringGap },
      uFadeIn: { value: 0.1 },
      uFadeOut: { value: 3.2 },
      uBurst: { value: 0 },
      uResolution: { value: new THREE.Vector2(width * dpr, height * dpr) },
      uColor: { value: new THREE.Color(color) },
      uColorTwo: { value: new THREE.Color(colorTwo) },
      uRingCount: { value: ringCount }
    }

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false
    })

    const geometry = new THREE.PlaneGeometry(2, 2)
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    container.appendChild(renderer.domElement)
    renderer.domElement.style.pointerEvents = 'none'

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      renderer.setSize(w, h)
      uniforms.uResolution.value.set(w * dpr, h * dpr)
    })
    resizeObserver.observe(container)

    let animateId = 0
    const animate = (t: number): void => {
      animateId = requestAnimationFrame(animate)
      uniforms.uTime.value = t * 0.001 * speed
      uniforms.uBurst.value += (burstRef.current - uniforms.uBurst.value) * 0.15
      renderer.render(scene, camera)
    }
    animateId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animateId)
      resizeObserver.disconnect()
      if (container && renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
      renderer.dispose()
      material.dispose()
      geometry.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={ctnRef}
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
        ...style
      }}
      onClick={clickBurst ? () => {
        burstRef.current = 1
        setTimeout(() => { burstRef.current = 0 }, 500)
      } : undefined}
    />
  )
}
