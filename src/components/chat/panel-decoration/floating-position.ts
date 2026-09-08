/**
 * fixed 浮层视口定位：右对齐触发器右缘，下方空间不足且上方放得下时向上翻转，
 * 整体 clamp 进视口。fixed 定位不受祖先 overflow:hidden / 滚动容器裁剪——
 * 消息流内的下拉菜单与确认弹层都靠它逃逸明细动画层和列表滚动的裁剪。
 */
export function positionFixedDropdown(trigger: HTMLElement, dropdown: HTMLElement, margin = 4) {
  const rect = trigger.getBoundingClientRect()
  dropdown.style.position = 'fixed'
  // 先复位再测量，避免上次定位的 inline 坐标影响 offsetWidth/offsetHeight。
  dropdown.style.left = '0px'
  dropdown.style.top = '0px'
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  const width = dropdown.offsetWidth
  const height = dropdown.offsetHeight
  const left = Math.min(Math.max(rect.right - width, 8), Math.max(8, viewportWidth - width - 8))
  let top = rect.bottom + margin
  let flipped = false
  if (top + height > viewportHeight - 8 && rect.top - margin - height >= 8) {
    top = rect.top - margin - height
    flipped = true
  } else {
    top = Math.min(top, Math.max(8, viewportHeight - height - 8))
  }
  dropdown.style.left = `${Math.round(left)}px`
  dropdown.style.top = `${Math.round(top)}px`
  return flipped
}
