import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

/**
 * Tripo's default export textures run up to 4096x4096 per map (base color +
 * normal + roughness/metalness), ~3 per material. Uncompressed on the GPU
 * that's tens of MB *per texture* with mipmaps — across the game's 8
 * generated models it adds up to roughly 1GB of texture memory. Desktop and
 * Android Chrome absorb that fine; iOS Safari's WebGL context does not and
 * silently kills the tab under memory pressure. None of these assets render
 * larger than a few hundred pixels on screen in actual gameplay, so this cap
 * is not a visible quality loss in practice.
 */
const MAX_TEXTURE_SIZE = 1024;

function downscaleTexture(texture: THREE.Texture, maxSize: number): void {
  const image = texture.image as { width?: number; height?: number } | undefined;
  if (!image?.width || !image.height || Math.max(image.width, image.height) <= maxSize) return;
  const scale = maxSize / Math.max(image.width, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  texture.image = canvas;
  texture.needsUpdate = true;
}

/** Downscales every texture map (color, normal, roughness, emissive, ...) on every material in a loaded scene, in place. */
export function downscaleSceneTextures(root: THREE.Object3D, maxSize = MAX_TEXTURE_SIZE): void {
  const seen = new Set<THREE.Texture>();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        const texture = value as THREE.Texture | undefined;
        if (texture && typeof texture === 'object' && texture.isTexture && !seen.has(texture)) {
          seen.add(texture);
          downscaleTexture(texture, maxSize);
        }
      }
    }
  });
}

/**
 * Fetches a GLB once per URL and caches the promise; callers `.clone()` the
 * resolved template per instance. Only for static, non-skinned meshes
 * (props, creatures animated by the caller's own code) — geometry/material
 * are shared by reference across clones (standard Three.js behavior), only
 * the transform hierarchy is duplicated, so this is cheap even with many
 * simultaneous enemies on screen.
 */
export function loadModelTemplate(url: string): Promise<THREE.Object3D> {
  let cached = cache.get(url);
  if (!cached) {
    cached = loader.loadAsync(url).then((gltf) => {
      const template = gltf.scene;
      template.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      // Downscale once on the shared template — every clone's materials are
      // cloned from these (clone() copies the texture reference, not the
      // pixels), so this single pass covers every instance for free.
      downscaleSceneTextures(template);
      return template;
    });
    cache.set(url, cached);
  }
  return cached;
}

/**
 * Clones a template with its own material instances (geometry stays shared
 * — cheap and safe since nothing mutates it). Needed because plain
 * `Object3D.clone()` shares materials by reference: without this, a
 * hit-flash on one enemy would flash every enemy of the same type sharing
 * the cached template.
 */
export function cloneWithUniqueMaterials(template: THREE.Object3D): THREE.Object3D {
  const instance = template.clone(true);
  instance.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
  });
  return instance;
}

/** Scales a cloned template so its bounding-box height matches targetHeight, with its base sitting at local y=0. */
export function normalizeModelScale(instance: THREE.Object3D, targetHeight: number): void {
  instance.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(instance);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = targetHeight / Math.max(size.y, 0.001);
  instance.scale.setScalar(scale);
  instance.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(instance);
  instance.position.y -= scaledBox.min.y;
}

/** Pulses a reddish emissive hit-flash on generated materials, restoring each one's original (possibly non-black, e.g. baked-in glow) emissive when inactive. */
export function setModelHitFlash(materials: readonly THREE.MeshStandardMaterial[], active: boolean, intensity: number): void {
  for (const material of materials) {
    if (material.userData.baseEmissive === undefined) {
      material.userData.baseEmissive = material.emissive.clone();
      material.userData.baseEmissiveIntensity = material.emissiveIntensity;
    }
    if (active) {
      material.emissive.setRGB(1, 0.25, 0.25);
      material.emissiveIntensity = intensity;
    } else {
      material.emissive.copy(material.userData.baseEmissive as THREE.Color);
      material.emissiveIntensity = material.userData.baseEmissiveIntensity as number;
    }
  }
}

/** Collects every MeshStandardMaterial on an instance (for hit-flash / damage-tint effects). */
export function collectStandardMaterials(instance: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const materials: THREE.MeshStandardMaterial[] = [];
  instance.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) materials.push(material as THREE.MeshStandardMaterial);
  });
  return materials;
}
