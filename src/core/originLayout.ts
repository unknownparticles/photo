export type OriginMap = { scaleX: number; scaleY: number; x: number; y: number };

export function originLayerStyle(
  assetWidth: number,
  assetHeight: number,
  displayWidth: number,
  displayHeight: number,
  originWidth: number,
  originHeight: number,
  map: OriginMap,
) {
  const curToDisplayX = displayWidth / assetWidth;
  const curToDisplayY = displayHeight / assetHeight;
  return {
    width: (originWidth / map.scaleX) * curToDisplayX,
    height: (originHeight / map.scaleY) * curToDisplayY,
    left: -(map.x / map.scaleX) * curToDisplayX,
    top: -(map.y / map.scaleY) * curToDisplayY,
  };
}
