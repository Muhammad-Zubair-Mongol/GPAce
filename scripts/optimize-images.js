/**
 * Image Optimization Script for GPAce
 * 
 * This script converts the logo PNG to WebP format and creates optimized versions.
 * 
 * Prerequisites:
 * - Node.js installed
 * - sharp package: npm install sharp
 * 
 * Usage: node scripts/optimize-images.js
 * 
 * Performance Impact:
 * - Original: ~64KB 500x500px PNG
 * - Optimized: ~5-10KB 160x160px WebP (for 2x retina)
 * - Expected savings: ~85-90% file size reduction
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const IMAGES_DIR = path.join(__dirname, '..', 'assets', 'images');

// Image optimization configurations
const OPTIMIZATIONS = [
    {
        input: 'gpace-logo-white.png',
        outputs: [
            {
                filename: 'gpace-logo-white.webp',
                width: 160,  // 2x for 80px display
                height: 160,
                format: 'webp',
                quality: 85
            },
            {
                filename: 'gpace-logo-white-1x.webp',
                width: 80,   // 1x for standard displays
                height: 80,
                format: 'webp',
                quality: 85
            },
            {
                filename: 'gpace-logo-white-optimized.png',
                width: 160,  // Optimized PNG fallback
                height: 160,
                format: 'png',
                compressionLevel: 9
            }
        ]
    }
];

async function optimizeImages() {
    console.log('🖼️  GPAce Image Optimization Script');
    console.log('===================================\n');

    for (const config of OPTIMIZATIONS) {
        const inputPath = path.join(IMAGES_DIR, config.input);

        // Check if input file exists
        if (!fs.existsSync(inputPath)) {
            console.error(`❌ Input file not found: ${inputPath}`);
            continue;
        }

        const inputStats = fs.statSync(inputPath);
        console.log(`📥 Input: ${config.input}`);
        console.log(`   Size: ${(inputStats.size / 1024).toFixed(2)} KB\n`);

        for (const output of config.outputs) {
            const outputPath = path.join(IMAGES_DIR, output.filename);

            try {
                let transformer = sharp(inputPath)
                    .resize(output.width, output.height, {
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 }
                    });

                if (output.format === 'webp') {
                    transformer = transformer.webp({ quality: output.quality });
                } else if (output.format === 'png') {
                    transformer = transformer.png({ compressionLevel: output.compressionLevel });
                }

                await transformer.toFile(outputPath);

                const outputStats = fs.statSync(outputPath);
                const savings = ((1 - outputStats.size / inputStats.size) * 100).toFixed(1);

                console.log(`📤 Output: ${output.filename}`);
                console.log(`   Size: ${(outputStats.size / 1024).toFixed(2)} KB`);
                console.log(`   Dimensions: ${output.width}x${output.height}`);
                console.log(`   Savings: ${savings}%\n`);

            } catch (error) {
                console.error(`❌ Error processing ${output.filename}:`, error.message);
            }
        }
    }

    console.log('✅ Image optimization complete!\n');
    console.log('Next steps:');
    console.log('1. The WebP files are now ready to use');
    console.log('2. academic-details.html already has picture element support');
    console.log('3. Test in browser to verify images load correctly');
}

// Run if called directly
if (require.main === module) {
    optimizeImages().catch(console.error);
}

module.exports = { optimizeImages };
