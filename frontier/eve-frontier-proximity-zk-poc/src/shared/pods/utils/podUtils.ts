import { POD, PODEntries, PODValue, JSONPOD, PODStringValue } from "@pcd/pod";

export interface CreateAndSignPodResult {
    signedPod: POD;
    jsonPod: JSONPOD;
}

/**
 * Signs a POD with the provided entries and private key, and returns relevant objects.
 *
 * This function encapsulates several "rules" for POD generation:
 *
 * @param podEntries The initial data entries for the POD.
 * @param signerPrivateKey The private key string for signing the POD.
 * @returns An object containing the signed POD and its JSON representation.
 */
export async function signPod(
    podEntries: PODEntries,
    signerPrivateKey: string,
): Promise<CreateAndSignPodResult> {

    // Sign the final PODEntries
    const signedPod = POD.sign(podEntries, signerPrivateKey);

    // 4. Get JSON representation
    const jsonPod = signedPod.toJSON();

    return {
        signedPod,
        jsonPod,
    };
} 