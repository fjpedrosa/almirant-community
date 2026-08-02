import {
  claimUserStorageDeletions,
  completeUserStorageDeletion,
  deleteUserStorageObject,
  finalizeUserStorageObject,
  getUserStorageObject,
  getUserStorageUsage,
  listUserStorageObjects,
  releaseExpiredUserStorageReservations,
  releaseUserStorageReservation,
  reserveUserStorageObject,
  failUserStorageDeletion,
} from "@almirant/database";
import { createUserStorageService } from "./user-storage-service";
import { userStorageObjectStore } from "./user-storage-object-store";

export const userStorageService = createUserStorageService({
  repository: {
    reserveObject: reserveUserStorageObject,
    finalizeObject: finalizeUserStorageObject,
    releaseReservation: releaseUserStorageReservation,
    releaseExpiredReservations: releaseExpiredUserStorageReservations,
    deleteObject: deleteUserStorageObject,
    getObject: getUserStorageObject,
    listObjects: listUserStorageObjects,
    getUsage: getUserStorageUsage,
    claimDeletions: claimUserStorageDeletions,
    completeDeletion: completeUserStorageDeletion,
    failDeletion: failUserStorageDeletion,
  },
  objectStore: userStorageObjectStore,
});
