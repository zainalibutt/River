import type { Card } from '@river/engine'
import * as THREE from 'three'

/**
 * The faces of the cards on the felt, drawn rather than shipped.
 *
 * The table had no card faces at all. The board was five blank slabs from the first deal,
 * preflop included, and a showdown turned nothing over, so the moment a hand is decided
 * happened in a caption. A face is four characters of type on card stock, and a canvas
 * draws one in well under a millisecond, which is cheaper than a 52-image atlas to ship,
 * load and keep in step with the 2D cards. The colours are the 2D cards' own - a four
 * colour deck, so a flush reads from across the room.
 */
const FACE_WIDTH = 256
const FACE_HEIGHT = 358

const INK: Readonly<Record<Card['suit'], string>> = {
  s: '#1a1a1a',
  h: '#c4362a',
  d: '#2a64a0',
  c: '#1c6b3e',
}

const SYMBOL: Readonly<Record<Card['suit'], string>> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
}

const faces = new Map<string, THREE.Texture>()

export function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`
}

/** The face of one card, drawn once and shared by every mesh that shows it. */
export function cardFaceTexture(card: Card): THREE.Texture | null {
  const key = cardKey(card)
  const cached = faces.get(key)
  if (cached !== undefined) return cached
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = FACE_WIDTH
  canvas.height = FACE_HEIGHT
  const context = canvas.getContext('2d')
  if (context === null) return null

  // Stock, falling off from the lamp like the 2D card, with a printed border.
  const stock = context.createLinearGradient(0, 0, FACE_WIDTH, FACE_HEIGHT)
  stock.addColorStop(0, '#fdfaf4')
  stock.addColorStop(0.46, '#f7f3ec')
  stock.addColorStop(1, '#eae3d6')
  context.fillStyle = stock
  context.fillRect(0, 0, FACE_WIDTH, FACE_HEIGHT)
  context.strokeStyle = '#d9d2c6'
  context.lineWidth = 6
  context.strokeRect(9, 9, FACE_WIDTH - 18, FACE_HEIGHT - 18)

  const ink = INK[card.suit]
  const symbol = SYMBOL[card.suit]
  context.fillStyle = ink
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  // The index, large: at the gameplay camera a card on the felt is a few dozen pixels, and
  // the index is the part a player reads.
  context.font = '800 104px system-ui, sans-serif'
  context.fillText(card.rank, 64, 74)
  context.font = '700 78px system-ui, sans-serif'
  context.fillText(symbol, 64, 160)
  context.font = '700 150px system-ui, sans-serif'
  context.fillText(symbol, FACE_WIDTH * 0.62, FACE_HEIGHT * 0.66)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  faces.set(key, texture)
  return texture
}

/**
 * The back, as the 2D cards draw it: the house maroon, a double border and the monogram.
 * The cards on the felt were cream slabs on every side, so a hand lying face down and the
 * same hand turned over looked the same.
 */
let back: THREE.Texture | null = null

export function cardBackTexture(): THREE.Texture | null {
  if (back !== null) return back
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = FACE_WIDTH
  canvas.height = FACE_HEIGHT
  const context = canvas.getContext('2d')
  if (context === null) return null
  context.fillStyle = '#5a2733'
  context.fillRect(0, 0, FACE_WIDTH, FACE_HEIGHT)
  context.strokeStyle = '#7a3a46'
  context.lineWidth = 8
  context.strokeRect(14, 14, FACE_WIDTH - 28, FACE_HEIGHT - 28)
  context.lineWidth = 3
  context.strokeRect(28, 28, FACE_WIDTH - 56, FACE_HEIGHT - 56)
  context.fillStyle = 'rgb(247 243 236 / 55%)'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = '600 120px Georgia, serif'
  context.fillText('R', FACE_WIDTH / 2, FACE_HEIGHT / 2 + 6)
  back = new THREE.CanvasTexture(canvas)
  back.colorSpace = THREE.SRGBColorSpace
  back.anisotropy = 8
  return back
}

let sharedEdge: THREE.Material | null = null
let sharedBack: THREE.Material | null = null

function edgeMaterial(): THREE.Material {
  sharedEdge ??= new THREE.MeshStandardMaterial({ color: '#e8ded0', roughness: 0.7 })
  return sharedEdge
}

function backMaterial(): THREE.Material {
  if (sharedBack === null) {
    const map = cardBackTexture()
    sharedBack = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.62 })
    if (map !== null) (sharedBack as THREE.MeshStandardMaterial).map = map
  }
  return sharedBack
}

/** A face-down card: the back up, and nothing to read. Shared by every hole card. */
export function cardBackMaterials(): THREE.Material[] {
  const edge = edgeMaterial()
  const cover = backMaterial()
  return [edge, edge, cover, cover, edge, edge]
}

/**
 * A card as six material slots, in BoxGeometry's order: +x, -x, +y, -y, +z, -z.
 *
 * The face is +y, so a card lying face up shows it and one turned over shows the back.
 * Materials are made per face and cached with it, and the edge and back are shared.
 */
const cardMaterials = new Map<string, THREE.Material[]>()

export function cardMaterialsFor(card: Card): THREE.Material[] {
  const key = cardKey(card)
  const cached = cardMaterials.get(key)
  if (cached !== undefined) return cached
  const map = cardFaceTexture(card)
  const face = new THREE.MeshStandardMaterial({ roughness: 0.55, color: '#ffffff' })
  if (map !== null) face.map = map
  const edge = edgeMaterial()
  const materials = [edge, edge, face, backMaterial(), edge, edge]
  cardMaterials.set(key, materials)
  return materials
}
