import { describe, expect, it } from 'vitest'
import { parseBatchEntries, parseBatchLines, parseTimedBatchEntries } from './batch'

describe('多行批量输入', () => {
  it('按原顺序清理首尾空格并忽略空行', () => {
    expect(parseBatchLines('  牛奶  \n\n 面包\r\n  \n纸 ')).toEqual([
      '牛奶',
      '面包',
      '纸',
    ])
  })

  it('保留内容相同的重复项目', () => {
    expect(parseBatchLines('牛奶\n牛奶')).toEqual(['牛奶', '牛奶'])
  })

  it('单行保持原有新增语义', () => {
    expect(parseBatchLines('  写周报  ')).toEqual(['写周报'])
  })

  it('保留原始行号，便于精确反馈失败项', () => {
    expect(parseBatchEntries('第一项\n\n  第三项  ')).toEqual([
      { line: 1, value: '第一项' },
      { line: 3, value: '第三项' },
    ])
  })

  it('逐行识别本地时间，并让无时间行保持未排定', () => {
    expect(parseTimedBatchEntries('8.00 起床\n检查护照\n09:30 公交')).toEqual([
      { line: 1, value: '8.00 起床', title: '起床', time: '08:00' },
      { line: 2, value: '检查护照', title: '检查护照' },
      { line: 3, value: '09:30 公交', title: '公交', time: '09:30' },
    ])
  })

  it('明确报告非法时间，不把它静默写进标题', () => {
    expect(parseTimedBatchEntries('25:10 出发')[0]).toMatchObject({
      line: 1,
      title: '出发',
      errorCode: 'invalid_time',
      error: '时间格式无效',
    })
  })

  it('纯时间输入需要补充任务名称，不进入可提交状态', () => {
    expect(parseTimedBatchEntries('18:00')[0]).toMatchObject({
      line: 1,
      value: '18:00',
      title: '',
      errorCode: 'missing_title',
      error: '时间后缺少任务名称',
    })
  })
})
