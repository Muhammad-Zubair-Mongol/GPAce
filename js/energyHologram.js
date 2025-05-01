import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class EnergyHologram {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true, 
            alpha: true,
            premultipliedAlpha: false
        });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setClearColor(0x000000, 0);
        container.appendChild(this.renderer.domElement);

        // Set canvas background to transparent
        this.renderer.domElement.style.background = 'transparent';

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.enableZoom = false;

        this.camera.position.z = 5;

        // Add ambient light
        const ambientLight = new THREE.AmbientLight(0x404040);
        this.scene.add(ambientLight);

        // Add directional light
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 5, 5);
        this.scene.add(directionalLight);

        // Create a group to hold our energy visualization
        this.energyGroup = new THREE.Group();
        this.scene.add(this.energyGroup);

        // Initialize properties for smooth transitions
        this.maxRings = 7;
        this.rings = [];
        this.targetOpacities = new Array(this.maxRings).fill(0);
        this.currentOpacities = new Array(this.maxRings).fill(0);
        this.currentColor = new THREE.Color(0x00ff00);
        this.targetColor = new THREE.Color(0x00ff00);
        this.transitionSpeed = 0.05;

        this.createRings();
        this.createCentralSphere();
        
        this.energyLevel = 1;
        this.updateEnergyLevel(1); // Start with level 1
        this.animate();

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize(), false);

        // Start auto-update every 30 seconds
        this.startAutoUpdate();
    }

    startAutoUpdate() {
        setInterval(() => {
            const storedLevel = localStorage.getItem('currentEnergyLevel');
            if (storedLevel) {
                this.updateEnergyLevel(parseInt(storedLevel));
            }
        }, 30000);
    }

    getColorForLevel(level) {
        // Create a gradient from green (level 1) to red (level 7)
        const colors = {
            1: new THREE.Color(0x00ff00), // Bright green - fully alert
            2: new THREE.Color(0x66ff00), // Light green
            3: new THREE.Color(0xccff00), // Yellow-green
            4: new THREE.Color(0xffff00), // Yellow
            5: new THREE.Color(0xff9900), // Orange
            6: new THREE.Color(0xff3300), // Orange-red
            7: new THREE.Color(0xff0000)  // Red - exhausted
        };
        
        return colors[level];
    }

    createRings() {
        for (let i = 0; i < this.maxRings; i++) {
            const geometry = new THREE.TorusGeometry(1 + i * 0.3, 0.02, 16, 100);
            const material = new THREE.MeshPhongMaterial({
                transparent: true,
                opacity: 0,
                side: THREE.DoubleSide,
                emissive: new THREE.Color(0x00ff00),
                emissiveIntensity: 0.5
            });
            
            const ring = new THREE.Mesh(geometry, material);
            ring.rotation.x = Math.PI / 2;
            this.rings.push(ring);
            this.energyGroup.add(ring);
        }
    }

    createCentralSphere() {
        const sphereGeometry = new THREE.SphereGeometry(0.5, 32, 32);
        const sphereMaterial = new THREE.MeshPhongMaterial({
            transparent: true,
            opacity: 0.9,
            emissive: new THREE.Color(0x00ff00),
            emissiveIntensity: 0.5
        });
        
        this.centralSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
        this.energyGroup.add(this.centralSphere);
    }

    updateEnergyLevel(level) {
        this.energyLevel = Math.max(1, Math.min(7, level));
        
        // Set target color
        this.targetColor = this.getColorForLevel(this.energyLevel);
        
        // Calculate number of visible rings (inverse relationship)
        const visibleRings = 8 - this.energyLevel; // Level 1: 7 rings, Level 7: 1 ring
        
        // Update target opacities for each ring
        this.targetOpacities = this.rings.map((_, index) => {
            if (index < visibleRings) {
                return 0.7 - (index * 0.1); // Fade out outer rings slightly
            }
            return 0;
        });

        localStorage.setItem('currentEnergyLevel', this.energyLevel.toString());
    }

    updateTransitions() {
        // Update color transitions
        this.currentColor.lerp(this.targetColor, this.transitionSpeed);
        
        // Update central sphere
        this.centralSphere.material.color.copy(this.currentColor);
        this.centralSphere.material.emissive.copy(this.currentColor);
        
        // Update ring opacities and colors
        this.rings.forEach((ring, index) => {
            // Smoothly transition opacity
            this.currentOpacities[index] += (this.targetOpacities[index] - this.currentOpacities[index]) * this.transitionSpeed;
            ring.material.opacity = this.currentOpacities[index];
            
            // Update ring color
            ring.material.color.copy(this.currentColor);
            ring.material.emissive.copy(this.currentColor);
            
            // Add pulsing effect based on energy level
            const pulseSpeed = 1.5 - (this.energyLevel * 0.15); // Slower pulse for lower energy
            const pulseIntensity = 0.2 - (this.energyLevel * 0.02); // Less intense pulse for lower energy
            const pulse = Math.sin(Date.now() * 0.001 * pulseSpeed) * pulseIntensity;
            ring.material.emissiveIntensity = 0.5 + pulse;
        });
    }

    onWindowResize() {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        // Update transitions
        this.updateTransitions();

        // Rotate the energy group
        this.energyGroup.rotation.y += 0.005;
        
        // Make rings oscillate
        this.rings.forEach((ring, index) => {
            if (ring.material.opacity > 0.1) {
                const oscillation = Math.sin(Date.now() * 0.001 + index) * 0.1;
                ring.scale.setScalar(1 + oscillation);
            }
        });

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

// Initialize the hologram when the DOM is loaded
let hologram;
document.addEventListener('DOMContentLoaded', () => {
    const container = document.querySelector('.hologram-container');
    if (container) {
        hologram = new EnergyHologram(container);
        window.energyHologram = hologram;

        // Check for stored energy level
        const storedLevel = localStorage.getItem('currentEnergyLevel');
        if (storedLevel) {
            hologram.updateEnergyLevel(parseInt(storedLevel));
        }
    }
});

export function updateHologramEnergy(level) {
    if (hologram) {
        hologram.updateEnergyLevel(level);
    }
}

export { EnergyHologram };
// Add missing initHologram function export to fix grind.html:942 error
export function initHologram(containerId) {
  document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById(containerId) || document.querySelector('.hologram-container');
    if (container) {
      hologram = new EnergyHologram(container);
      window.energyHologram = hologram;

      // Check for stored energy level
      const storedLevel = localStorage.getItem('currentEnergyLevel');
      if (storedLevel) {
        hologram.updateEnergyLevel(parseInt(storedLevel));
      }
    } else {
      console.error(`Hologram container #${containerId} not found`);
    }
  });
}
