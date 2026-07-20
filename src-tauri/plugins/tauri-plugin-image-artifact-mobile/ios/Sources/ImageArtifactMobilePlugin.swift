// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import Foundation
import Photos
import SwiftRs
import Tauri
import UIKit

struct ImageArtifactPayload: Decodable {
  let fileName: String
  let pngDataUrl: String
}

struct ImageArtifactDeliveryResult: Encodable {
  let fileName: String
  let source: String
  let cancelled: Bool?
}

class ImageArtifactMobilePlugin: Plugin {
  @objc public func getCapabilities(_ invoke: Invoke) throws {
    invoke.resolve([
      "canSaveToAlbum": true,
      "canShareImage": true,
    ])
  }

  @objc public func saveImageToAlbum(_ invoke: Invoke) throws {
    do {
      let args = try invoke.parseArgs(ImageArtifactPayload.self)
      let fileName = normalizePngFileName(args.fileName)
      let pngData = try decodePng(args.pngDataUrl)

      requestPhotoLibraryAuthorization { granted in
        guard granted else {
          invoke.reject(
            "没有相册保存权限。你可以改用分享，或导出为文件。",
            code: "image_artifact_album_permission_denied"
          )
          return
        }

        PHPhotoLibrary.shared().performChanges({
          let request = PHAssetCreationRequest.forAsset()
          let options = PHAssetResourceCreationOptions()
          options.originalFilename = fileName
          request.addResource(with: .photo, data: pngData, options: options)
        }, completionHandler: { success, error in
          if success {
            DispatchQueue.main.async {
              invoke.resolve(ImageArtifactDeliveryResult(
                fileName: fileName,
                source: "album",
                cancelled: false
              ))
            }
            return
          }

          let message = error?.localizedDescription ?? "保存到相册失败。"
          DispatchQueue.main.async {
            invoke.reject(message, code: "image_artifact_save_failed")
          }
        })
      }
    } catch {
      invoke.reject(error.localizedDescription, code: "image_artifact_save_failed")
    }
  }

  @objc public func shareImage(_ invoke: Invoke) throws {
    do {
      let args = try invoke.parseArgs(ImageArtifactPayload.self)
      let fileName = normalizePngFileName(args.fileName)
      let pngData = try decodePng(args.pngDataUrl)
      let tempUrl = try writeTempShareImage(fileName, pngData: pngData)

      DispatchQueue.main.async {
        guard let viewController = self.manager.viewController else {
          invoke.reject("当前环境不支持系统分享。", code: "image_artifact_share_failed")
          return
        }

        let shareSheet = UIActivityViewController(activityItems: [tempUrl], applicationActivities: nil)
        if let popover = shareSheet.popoverPresentationController {
          popover.sourceView = viewController.view
          popover.sourceRect = CGRect(
            x: viewController.view.bounds.midX,
            y: viewController.view.bounds.midY,
            width: 0,
            height: 0
          )
          popover.permittedArrowDirections = []
        }

        shareSheet.completionWithItemsHandler = { _, completed, _, error in
          if let error = error {
            invoke.reject(error.localizedDescription, code: "image_artifact_share_failed")
            return
          }

          DispatchQueue.main.async {
            invoke.resolve(ImageArtifactDeliveryResult(
              fileName: fileName,
              source: "shareSheet",
              cancelled: !completed
            ))
          }
        }

        viewController.present(shareSheet, animated: true)
      }
    } catch {
      invoke.reject(error.localizedDescription, code: "image_artifact_share_failed")
    }
  }

  private func requestPhotoLibraryAuthorization(completion: @escaping (Bool) -> Void) {
    if #available(iOS 14, *) {
      let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
      switch status {
      case .authorized, .limited:
        completion(true)
      case .notDetermined:
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { nextStatus in
          DispatchQueue.main.async {
            completion(nextStatus == .authorized || nextStatus == .limited)
          }
        }
      default:
        completion(false)
      }
    } else {
      let status = PHPhotoLibrary.authorizationStatus()
      switch status {
      case .authorized:
        completion(true)
      case .notDetermined:
        PHPhotoLibrary.requestAuthorization { nextStatus in
          DispatchQueue.main.async {
            completion(nextStatus == .authorized)
          }
        }
      default:
        completion(false)
      }
    }
  }

  private func writeTempShareImage(_ fileName: String, pngData: Data) throws -> URL {
    let directory = FileManager.default
      .urls(for: .cachesDirectory, in: .userDomainMask)
      .first?
      .appendingPathComponent("image-artifacts", isDirectory: true)

    guard let directory = directory else {
      throw ImageArtifactError.unavailable("无法创建分享临时目录。")
    }

    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: nil
    )

    let fileUrl = directory.appendingPathComponent(fileName)
    try? FileManager.default.removeItem(at: fileUrl)
    try pngData.write(to: fileUrl, options: .atomic)
    return fileUrl
  }

  private func normalizePngFileName(_ fileName: String) -> String {
    let trimmed = fileName.trimmingCharacters(in: .whitespacesAndNewlines)
    let base = trimmed.isEmpty ? "reading-report.png" : trimmed
    let invalidCharacters = CharacterSet(charactersIn: "\\/:*?\"<>|")
    let cleanedScalars = base.unicodeScalars.map { scalar -> String in
      invalidCharacters.contains(scalar) ? "-" : String(scalar)
    }
    let normalized = cleanedScalars.joined()
      .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)

    let cleaned = String(normalized.prefix(120))
      .trimmingCharacters(in: CharacterSet(charactersIn: " .-"))

    let safe = cleaned.isEmpty ? "reading-report.png" : String(cleaned)
    return safe.lowercased().hasSuffix(".png") ? safe : "\(safe).png"
  }

  private func decodePng(_ pngDataUrl: String) throws -> Data {
    let payload = pngDataUrl.components(separatedBy: "base64,").last ?? pngDataUrl
    guard let data = Data(base64Encoded: payload, options: [.ignoreUnknownCharacters]) else {
      throw ImageArtifactError.invalidPng("图片内容不是有效的 PNG 数据。")
    }

    guard data.starts(with: Self.pngSignature) else {
      throw ImageArtifactError.invalidPng("图片内容不是有效的 PNG 数据。")
    }

    return data
  }
}

enum ImageArtifactError: LocalizedError {
  case invalidPng(String)
  case unavailable(String)

  var errorDescription: String? {
    switch self {
    case .invalidPng(let message), .unavailable(let message):
      return message
    }
  }
}

@_cdecl("init_plugin_image_artifact_mobile")
func initPlugin() -> Plugin {
  return ImageArtifactMobilePlugin()
}

private extension ImageArtifactMobilePlugin {
  static let pngSignature = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
}
