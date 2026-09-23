# MobileSAM model assets

MobileSAM TinyViT (`vit_t`) image encoder and single-mask SAM decoder, published by [Acly/MobileSAM](https://huggingface.co/Acly/MobileSAM/tree/0d3b403339b4674a82493d5e97964dd78089ddc8). Upstream [MobileSAM](https://github.com/ChaoningZhang/MobileSAM) uses Apache-2.0 licensing. These are optional local-browser models, requested only on Select Object activation.

| Local file | Upstream file | Bytes | SHA-256 |
| --- | --- | --- | --- |
| encoder.onnx | mobile_sam_image_encoder.onnx | 28157093 | 580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749 |
| decoder.onnx | sam_mask_decoder_single.onnx | 16501323 | 93915fc7c993ab9d59ab8c9ccd3bce37f7509c81ab4150a74abd4d2abbd8570d |

Frames are resized with longest side 1024. The HWC encoder export includes RGB normalization and bottom/right padding. Point coordinates are scaled with the rounded resize dimensions. The decoder receives a single positive point and SAM's unused-point padding marker, no prior mask, and original frame dimensions; its full-resolution logits are thresholded at zero.
