import path from 'path';
import fs from 'fs/promises';
import { readJsonFile, writeJsonFile } from '../../../src/shared/utils/fsUtils';

describe('File System Utils Tests', () => {
    const testOutputDir = path.resolve(process.cwd(), 'outputs', 'test-utils');
    const testFilePath = path.join(testOutputDir, 'test-data.json');

    afterEach(async () => {
        // Clean up test files
        try {
            await fs.unlink(testFilePath);
        } catch (error) {
            // Ignore if file doesn't exist
        }
        try {
            await fs.rmdir(testOutputDir);
        } catch (error) {
            // Ignore if directory doesn't exist or isn't empty
        }
    });

    describe('writeJsonFile', () => {
        it('should write JSON file with BigInt values converted to strings', async () => {
            const testData = {
                timestamp: BigInt('12345678901234567890'),
                regularNumber: 42,
                regularString: 'test',
                nested: {
                    bigIntValue: BigInt('98765432109876543210'),
                    regularValue: 'nested-test'
                },
                array: [BigInt('111'), BigInt('222'), 333]
            };

            await writeJsonFile(testFilePath, testData);

            // Verify file exists
            const fileStats = await fs.stat(testFilePath);
            expect(fileStats.isFile()).toBe(true);

            // Read raw file content
            const rawContent = await fs.readFile(testFilePath, 'utf-8');
            const parsed = JSON.parse(rawContent);

            // Verify BigInt values are converted to strings
            expect(parsed.timestamp).toBe('12345678901234567890');
            expect(typeof parsed.timestamp).toBe('string');
            expect(parsed.regularNumber).toBe(42);
            expect(parsed.regularString).toBe('test');
            expect(parsed.nested.bigIntValue).toBe('98765432109876543210');
            expect(typeof parsed.nested.bigIntValue).toBe('string');
            expect(parsed.nested.regularValue).toBe('nested-test');
            expect(parsed.array[0]).toBe('111');
            expect(parsed.array[1]).toBe('222');
            expect(parsed.array[2]).toBe(333);
        });

        it('should create directory if it does not exist', async () => {
            const nestedPath = path.join(testOutputDir, 'nested', 'deep', 'test.json');
            const testData = { value: 123 };

            await writeJsonFile(nestedPath, testData);

            // Verify directory was created
            const dirStats = await fs.stat(path.dirname(nestedPath));
            expect(dirStats.isDirectory()).toBe(true);

            // Verify file exists
            const fileStats = await fs.stat(nestedPath);
            expect(fileStats.isFile()).toBe(true);

            // Clean up nested directory
            await fs.unlink(nestedPath);
            await fs.rmdir(path.dirname(nestedPath));
            await fs.rmdir(path.dirname(path.dirname(nestedPath)));
        });

        it('should write complex nested structures correctly', async () => {
            const testData = {
                locationData: {
                    objectId: '0x' + '1'.repeat(64),
                    solarSystem: 987,
                    coordinates: { x: 1000, y: 2000, z: 3000 },
                    timestamp: BigInt(Date.now()),
                    salt: '0x' + 'a'.repeat(64)
                },
                proofData: {
                    merkleRoot: BigInt('0x1234567890abcdef'),
                    coordinatesHash: BigInt('0xfedcba0987654321'),
                    signatureAndKeyHash: BigInt('0xabcdef1234567890')
                }
            };

            await writeJsonFile(testFilePath, testData);

            const rawContent = await fs.readFile(testFilePath, 'utf-8');
            const parsed = JSON.parse(rawContent);

            // Verify structure is preserved
            expect(parsed.locationData.objectId).toBe(testData.locationData.objectId);
            expect(parsed.locationData.solarSystem).toBe(987);
            expect(parsed.locationData.coordinates.x).toBe(1000);
            expect(parsed.locationData.timestamp).toBe(testData.locationData.timestamp.toString());
            expect(typeof parsed.locationData.timestamp).toBe('string');
            expect(parsed.proofData.merkleRoot).toBe('0x1234567890abcdef');
            expect(typeof parsed.proofData.merkleRoot).toBe('string');
        });
    });

    describe('readJsonFile', () => {
        it('should read JSON file and return parsed data', async () => {
            const testData = {
                timestamp: '12345678901234567890',
                value: 42,
                nested: { key: 'value' }
            };

            await writeJsonFile(testFilePath, testData);
            const readData = await readJsonFile(testFilePath, {});

            expect(readData).toEqual(testData);
            expect(readData.timestamp).toBe('12345678901234567890');
            expect(readData.value).toBe(42);
            expect(readData.nested.key).toBe('value');
        });

        it('should return default value if file does not exist', async () => {
            const nonExistentPath = path.join(testOutputDir, 'non-existent.json');
            const defaultVal = { default: 'value' };

            const result = await readJsonFile(nonExistentPath, defaultVal);

            expect(result).toEqual(defaultVal);
        });

        it('should return default value if file is empty', async () => {
            // Create empty file
            await fs.mkdir(testOutputDir, { recursive: true });
            await fs.writeFile(testFilePath, '', 'utf-8');

            const defaultVal = { default: 'value' };
            const result = await readJsonFile(testFilePath, defaultVal);

            expect(result).toEqual(defaultVal);
        });

        it('should return default value if file contains invalid JSON', async () => {
            // Write invalid JSON
            await fs.mkdir(testOutputDir, { recursive: true });
            await fs.writeFile(testFilePath, '{ invalid json }', 'utf-8');

            const defaultVal = { default: 'value' };
            const result = await readJsonFile(testFilePath, defaultVal);

            expect(result).toEqual(defaultVal);
        });

        it('should read BigInt values that were written as strings', async () => {
            const testData = {
                timestamp: BigInt('12345678901234567890'),
                merkleRoot: BigInt('0xabcdef1234567890')
            };

            await writeJsonFile(testFilePath, testData);
            const readData = await readJsonFile(testFilePath, {});

            // BigInt values are stored as strings, so they come back as strings
            expect(readData.timestamp).toBe('12345678901234567890');
            expect(typeof readData.timestamp).toBe('string');
            expect(readData.merkleRoot).toBe('0xabcdef1234567890');
            expect(typeof readData.merkleRoot).toBe('string');
        });

        it('should handle complex data structures with BigInt strings', async () => {
            const testData = {
                locationData1: {
                    objectId: '0x1111111111111111111111111111111111111111111111111111111111111111',
                    timestamp: '12345678901234567890',
                    coordinates: { x: 1000, y: 2000, z: 3000 }
                },
                locationData2: {
                    objectId: '0x2222222222222222222222222222222222222222222222222222222222222222',
                    timestamp: '98765432109876543210',
                    coordinates: { x: 2000, y: 3000, z: 4000 }
                },
                proofData: {
                    merkleRoot1: '0xabcdef1234567890',
                    merkleRoot2: '0xfedcba0987654321'
                }
            };

            await writeJsonFile(testFilePath, testData);
            const readData = await readJsonFile(testFilePath, {});

            expect(readData).toEqual(testData);
            expect(readData.locationData1.timestamp).toBe('12345678901234567890');
            expect(readData.locationData2.timestamp).toBe('98765432109876543210');
        });
    });

    describe('writeJsonFile and readJsonFile integration', () => {
        it('should write and read data maintaining BigInt string format', async () => {
            const originalData = {
                timestamp: BigInt('12345678901234567890'),
                value: 42,
                nested: {
                    bigInt: BigInt('98765432109876543210')
                }
            };

            await writeJsonFile(testFilePath, originalData);
            const readData = await readJsonFile(testFilePath, {});

            // Verify BigInt values are preserved as strings
            expect(readData.timestamp).toBe('12345678901234567890');
            expect(readData.value).toBe(42);
            expect(readData.nested.bigInt).toBe('98765432109876543210');
        });

        it('should handle round-trip for location attestation data format', async () => {
            const step1Data = {
                locationData1: {
                    objectId: '0x1111111111111111111111111111111111111111111111111111111111111111',
                    solarSystem: 987,
                    coordinates: { x: 1000, y: 2000, z: 3000 },
                    pod_data_type: 'evefrontier.location_attestation',
                    timestamp: '12345678901234567890', // BigInt stored as string
                    salt: '0x' + 'a'.repeat(64)
                },
                locationData2: {
                    objectId: '0x2222222222222222222222222222222222222222222222222222222222222222',
                    solarSystem: 987,
                    coordinates: { x: 2000, y: 3000, z: 4000 },
                    pod_data_type: 'evefrontier.location_attestation',
                    timestamp: '98765432109876543210', // BigInt stored as string
                    salt: '0x' + 'b'.repeat(64)
                },
                proof1Result: {
                    filePath: '/path/to/proof1.json',
                    publicSignals: ['signal1', 'signal2', 'signal3']
                },
                proof2Result: {
                    filePath: '/path/to/proof2.json',
                    publicSignals: ['signal4', 'signal5', 'signal6']
                }
            };

            await writeJsonFile(testFilePath, step1Data);
            const readData = await readJsonFile(testFilePath, {});

            expect(readData).toEqual(step1Data);
            expect(readData.locationData1.timestamp).toBe('12345678901234567890');
            expect(readData.locationData2.timestamp).toBe('98765432109876543210');
        });
    });
});

