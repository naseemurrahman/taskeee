"""
TaskFlow Pro - Model Training Script
Fine-tunes EfficientNet-B0 on task completion photos.

Dataset structure:
  data/
    train/
      complete/     <- photos of completed tasks
      incomplete/   <- photos of incomplete tasks
    val/
      complete/
      incomplete/

Usage:
  python train.py --data-dir ./data --model-id maintenance_v1 --epochs 20
"""
import os
import argparse
import json
from datetime import datetime

import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from torchvision import datasets, models, transforms
from torch.optim.lr_scheduler import CosineAnnealingLR


def get_transforms():
    train_transforms = transforms.Compose([
        transforms.RandomResizedCrop(224),
        transforms.RandomHorizontalFlip(),
        transforms.RandomVerticalFlip(),
        transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2),
        transforms.RandomRotation(15),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    ])
    val_transforms = transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    ])
    return train_transforms, val_transforms


def train(args):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Training on: {device}")

    train_tf, val_tf = get_transforms()
    train_ds = datasets.ImageFolder(os.path.join(args.data_dir, "train"), train_tf)
    val_ds = datasets.ImageFolder(os.path.join(args.data_dir, "val"), val_tf)

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, num_workers=4, pin_memory=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=4, pin_memory=True)

    print(f"Train: {len(train_ds)} images | Val: {len(val_ds)} images")
    print(f"Classes: {train_ds.class_to_idx}")

    # Model: EfficientNet-B0 with fine-tuned classifier
    model = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.DEFAULT)
    # Freeze early layers, train from layer 6+
    for i, (name, param) in enumerate(model.features.named_parameters()):
        param.requires_grad = i >= 6

    model.classifier[1] = nn.Linear(model.classifier[1].in_features, 2)
    model = model.to(device)

    # Class weights for imbalanced datasets
    class_counts = [len(os.listdir(os.path.join(args.data_dir, "train", c)))
                    for c in ["complete", "incomplete"]]
    weights = torch.tensor([1.0 / c for c in class_counts]).to(device)
    criterion = nn.CrossEntropyLoss(weight=weights)

    optimizer = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=args.lr, weight_decay=0.01
    )
    scheduler = CosineAnnealingLR(optimizer, T_max=args.epochs)

    best_val_acc = 0.0
    history = []

    for epoch in range(args.epochs):
        # Training phase
        model.train()
        train_loss, train_correct = 0.0, 0
        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            train_loss += loss.item()
            train_correct += (outputs.argmax(1) == labels).sum().item()

        # Validation phase
        model.eval()
        val_loss, val_correct = 0.0, 0
        with torch.no_grad():
            for images, labels in val_loader:
                images, labels = images.to(device), labels.to(device)
                outputs = model(images)
                val_loss += criterion(outputs, labels).item()
                val_correct += (outputs.argmax(1) == labels).sum().item()

        train_acc = train_correct / len(train_ds)
        val_acc = val_correct / len(val_ds)
        scheduler.step()

        epoch_stats = {
            "epoch": epoch + 1,
            "train_loss": round(train_loss / len(train_loader), 4),
            "train_acc": round(train_acc, 4),
            "val_loss": round(val_loss / len(val_loader), 4),
            "val_acc": round(val_acc, 4),
        }
        history.append(epoch_stats)
        print(f"Epoch {epoch+1}/{args.epochs} | "
              f"Train Acc: {train_acc:.1%} | Val Acc: {val_acc:.1%}")

        # Save best model
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            os.makedirs(args.output_dir, exist_ok=True)
            torch.save(model.state_dict(), os.path.join(args.output_dir, f"{args.model_id}.pth"))
            print(f"  -> Best model saved (val_acc={val_acc:.1%})")

    # Save training metadata
    metadata = {
        "modelId": args.model_id,
        "bestValAccuracy": best_val_acc,
        "trainedAt": datetime.now().isoformat(),
        "epochs": args.epochs,
        "classes": train_ds.class_to_idx,
        "history": history
    }
    with open(os.path.join(args.output_dir, f"{args.model_id}_metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"\nTraining complete. Best val accuracy: {best_val_acc:.1%}")
    print(f"Model saved to: {os.path.join(args.output_dir, args.model_id + '.pth')}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--model-id", default="default_v1")
    parser.add_argument("--output-dir", default="./models")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-4)
    args = parser.parse_args()
    train(args)
