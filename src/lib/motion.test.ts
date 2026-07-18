import { describe, expect, it } from 'vitest'
import { MOTION, projectVelocity, spatialOriginFromRect } from './motion'

describe('Apple 风格动效参数', () => {
  it('速度投影保留方向，并让较快减速更短', () => {
    expect(projectVelocity(1000)).toBeCloseTo(499, 6)
    expect(projectVelocity(-1000)).toBeCloseTo(-499, 6)
    expect(projectVelocity(1000, 0.99)).toBeCloseTo(99, 6)
  })

  it('核心交互使用可重新定向的弹簧，减少动态效果使用无位移过渡', () => {
    expect(MOTION.route).toMatchObject({ type: 'spring', bounce: 0 })
    expect(MOTION.sheet).toMatchObject({ type: 'spring', bounce: 0 })
    expect(MOTION.momentum).toMatchObject({ type: 'spring', bounce: 0.12 })
    expect(MOTION.reduced).not.toHaveProperty('type', 'spring')
  })

  it('将来源卡片位置归一化并限制在稳定的视口范围内', () => {
    const centered = spatialOriginFromRect(
      { left: 20, top: 160, width: 350, height: 120 },
      390,
      844,
    )
    expect(centered.xPercent).toBe(50)
    expect(centered.yPercent).toBeCloseTo(26.066, 2)

    expect(spatialOriginFromRect(
      { left: -200, top: 900, width: 10, height: 20 },
      390,
      844,
    )).toEqual({ xPercent: 6, yPercent: 94 })
  })
})
