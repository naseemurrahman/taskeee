"""
TaskFlow Pro - AI Photo Verification Service + Insights Generation
FastAPI + PyTorch/TorchVision
"""
import os
import io
import json
import logging
from typing import Optional, List, Dict, Any
import asyncio
from datetime import datetime, timedelta

import boto3
import torch
import torchvision.transforms as transforms
from torchvision import models
from PIL import Image
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="TaskFlow AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ─── S3 Client ────────────────────────────────────────────────────────────
s3 = boto3.client(
    "s3",
    region_name=os.getenv("AWS_REGION", "us-east-1"),
)

# ─── Model Registry ──────────────────────────────────────────────────────
# Each task category can have its own trained model.
# Models are loaded lazily and cached in memory.
MODEL_REGISTRY = {}
MODELS_DIR = os.getenv("MODELS_DIR", "./models")
MODEL_VERSION = os.getenv("MODEL_VERSION", "v1.0.0")

# Preprocessing pipeline - standard ImageNet normalization
TRANSFORM = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])


def load_model(model_id: str = "default_v1") -> torch.nn.Module:
    """Load a model from disk or return cached version."""
    if model_id in MODEL_REGISTRY:
        return MODEL_REGISTRY[model_id]

    model_path = os.path.join(MODELS_DIR, f"{model_id}.pth")

    if os.path.exists(model_path):
        # Load fine-tuned model
        # Architecture: EfficientNet-B0 fine-tuned on task completion images
        model = models.efficientnet_b0(weights=None)
        # Binary classification: task complete vs incomplete
        model.classifier[1] = torch.nn.Linear(model.classifier[1].in_features, 2)
        model.load_state_dict(torch.load(model_path, map_location="cpu"))
        logger.info(f"Loaded fine-tuned model: {model_id}")
    else:
        # Fallback: use pretrained ImageNet weights as baseline
        # In production, always use a fine-tuned model
        logger.warning(f"Model {model_id} not found, using baseline ImageNet weights")
        model = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.DEFAULT)
        model.classifier[1] = torch.nn.Linear(model.classifier[1].in_features, 2)

    model.eval()
    MODEL_REGISTRY[model_id] = model
    return model


def fetch_image_from_s3(storage_key: str) -> Image.Image:
    """Download photo from S3 and return as PIL Image."""
    bucket = os.getenv("S3_BUCKET")
    response = s3.get_object(Bucket=bucket, Key=storage_key)
    image_bytes = response["Body"].read()
    return Image.open(io.BytesIO(image_bytes)).convert("RGB")


def run_inference(image: Image.Image, model: torch.nn.Module, threshold: float):
    """
    Run inference on an image.
    Returns: (verdict, confidence, labels)
    """
    with torch.no_grad():
        tensor = TRANSFORM(image).unsqueeze(0)  # Add batch dim
        output = model(tensor)
        probabilities = torch.softmax(output, dim=1)[0]

        # Class 0: task incomplete / Class 1: task complete
        incomplete_prob = probabilities[0].item()
        complete_prob = probabilities[1].item()

    labels = {
        "task_complete": round(complete_prob, 4),
        "task_incomplete": round(incomplete_prob, 4)
    }

    if complete_prob >= threshold:
        verdict = "approved"
        rejection_reason = None
    elif complete_prob >= 0.5:
        # Low confidence - send to manual review
        verdict = "manual_review"
        rejection_reason = f"Low confidence ({complete_prob:.1%}), requires human review"
    else:
        verdict = "rejected"
        rejection_reason = generate_rejection_reason(labels, complete_prob)

    return verdict, round(complete_prob, 4), labels, rejection_reason


def generate_rejection_reason(labels: dict, confidence: float) -> str:
    """Generate a human-readable rejection reason."""
    if confidence < 0.3:
        return "Image does not appear to show a completed task"
    elif confidence < 0.5:
        return f"Task completion not clearly visible (confidence: {confidence:.1%})"
    return "Task does not meet completion criteria"


# ─── Request/Response Models ─────────────────────────────────────────────
class ReviewRequest(BaseModel):
    photoId: str
    storageKey: str
    modelId: Optional[str] = "default_v1"
    threshold: Optional[float] = 0.75


class ReviewResponse(BaseModel):
    photoId: str
    verdict: str  # approved | rejected | manual_review
    confidence: float
    labels: dict
    rejectionReason: Optional[str]
    modelVersion: str


# ─── AI Insights Models ─────────────────────────────────────────────────────
class TaskData(BaseModel):
    id: str
    title: str
    status: str
    priority: str
    assignedTo: Optional[str] = None
    assignedToName: Optional[str] = None
    dueDate: Optional[str] = None
    createdAt: str
    completedAt: Optional[str] = None
    department: Optional[str] = None
    dependencyCount: Optional[int] = 0


class InsightRequest(BaseModel):
    tasks: List[TaskData]
    timeRange: Optional[str] = "30d"  # 7d, 30d, 90d
    insightTypes: Optional[List[str]] = ["productivity", "bottlenecks", "predictions", "recommendations"]


class InsightResponse(BaseModel):
    insights: Dict[str, Any]
    generatedAt: str
    timeRange: str
    taskCount: int


# ─── Task approval (text-based) ───────────────────────────────────────────
class TaskReviewRequest(BaseModel):
    taskId: str
    title: str
    description: Optional[str] = None
    notes: Optional[str] = None
    priority: Optional[str] = None
    dueDate: Optional[str] = None
    categoryId: Optional[str] = None
    orgId: Optional[str] = None


class TaskReviewResponse(BaseModel):
    taskId: str
    verdict: str  # approved | rejected | manual_review
    confidence: float
    rejectionReason: Optional[str]
    modelVersion: str


def heuristic_task_review(req: TaskReviewRequest) -> TaskReviewResponse:
    """
    Safe baseline for AI approval when no dedicated LLM/rules engine exists yet.
    - Approve when the submission is sufficiently detailed (title + description/notes)
    - Reject when it's clearly empty / placeholder text
    - Manual review when uncertain
    """
    text = " ".join([req.title or "", req.description or "", req.notes or ""]).strip().lower()
    if len((req.title or "").strip()) < 3:
        return TaskReviewResponse(
            taskId=req.taskId,
            verdict="rejected",
            confidence=0.15,
            rejectionReason="Task title is too short for approval",
            modelVersion=MODEL_VERSION
        )

    placeholders = ["test", "asdf", "lorem", "demo", "xxx", "todo"]
    if any(p == text.strip() for p in placeholders) or text.strip() in placeholders:
        return TaskReviewResponse(
            taskId=req.taskId,
            verdict="rejected",
            confidence=0.25,
            rejectionReason="Submission appears to be placeholder content",
            modelVersion=MODEL_VERSION
        )

    # Basic evidence heuristic: detailed text or clear due date + medium/high priority
    has_details = len(text) >= 120 or (req.description and len(req.description.strip()) >= 60) or (req.notes and len(req.notes.strip()) >= 60)
    if has_details:
        return TaskReviewResponse(
            taskId=req.taskId,
            verdict="approved",
            confidence=0.82,
            rejectionReason=None,
            modelVersion=MODEL_VERSION
        )

    # If something exists but not enough evidence, route to manual review
    return TaskReviewResponse(
        taskId=req.taskId,
        verdict="manual_review",
        confidence=0.55,
        rejectionReason="Insufficient detail for automatic approval",
        modelVersion=MODEL_VERSION
    )

# ─── Routes ──────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "modelsLoaded": list(MODEL_REGISTRY.keys())}


@app.post("/api/review", response_model=ReviewResponse)
async def review_photo(request: ReviewRequest):
    """Main endpoint: review a task photo and return AI verdict."""
    logger.info(f"Reviewing photo {request.photoId} with model {request.modelId}")

    try:
        # Run in thread pool to avoid blocking event loop
        loop = asyncio.get_event_loop()

        image = await loop.run_in_executor(None, fetch_image_from_s3, request.storageKey)
        model = load_model(request.modelId)
        verdict, confidence, labels, rejection_reason = await loop.run_in_executor(
            None, run_inference, image, model, request.threshold
        )

        logger.info(f"Photo {request.photoId}: {verdict} ({confidence:.2%})")

        return ReviewResponse(
            photoId=request.photoId,
            verdict=verdict,
            confidence=confidence,
            labels=labels,
            rejectionReason=rejection_reason,
            modelVersion=MODEL_VERSION
        )

    except s3.exceptions.NoSuchKey:
        raise HTTPException(status_code=404, detail="Photo not found in storage")
    except Exception as e:
        logger.error(f"Review failed for {request.photoId}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/task-review", response_model=TaskReviewResponse)
async def review_task(request: TaskReviewRequest):
    """
    Text-based AI approval endpoint for employee task submissions.
    This is a lightweight baseline implementation that can be replaced with a proper model later.
    """
    try:
        res = heuristic_task_review(request)
        logger.info(f"Task {request.taskId} review: {res.verdict} ({res.confidence})")
        return res
    except Exception as e:
        logger.error(f"Task review failed for {request.taskId}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/models/{model_id}/load")
def preload_model(model_id: str):
    """Pre-warm a model into memory."""
    load_model(model_id)
    return {"message": f"Model {model_id} loaded", "modelId": model_id}


# ─── AI Insights Generation ─────────────────────────────────────────────────
def analyze_productivity_patterns(tasks: List[TaskData]) -> Dict[str, Any]:
    """Analyze team productivity patterns and trends."""
    completed_tasks = [t for t in tasks if t.status in ['completed', 'manager_approved', 'ai_approved']]
    
    if not completed_tasks:
        return {"message": "No completed tasks to analyze"}
    
    # Calculate completion rates by department
    dept_stats = {}
    for task in completed_tasks:
        dept = task.department or "Unassigned"
        if dept not in dept_stats:
            dept_stats[dept] = {"completed": 0, "total": 0}
        dept_stats[dept]["completed"] += 1
    
    for task in tasks:
        dept = task.department or "Unassigned"
        if dept not in dept_stats:
            dept_stats[dept] = {"completed": 0, "total": 0}
        dept_stats[dept]["total"] += 1
    
    # Calculate average completion time
    completion_times = []
    for task in completed_tasks:
        if task.completedAt and task.createdAt:
            try:
                completed = datetime.fromisoformat(task.completedAt.replace('Z', '+00:00'))
                created = datetime.fromisoformat(task.createdAt.replace('Z', '+00:00'))
                completion_times.append((completed - created).days)
            except:
                continue
    
    avg_completion_time = sum(completion_times) / len(completion_times) if completion_times else 0
    
    # Identify most productive days/times
    day_completion = {}
    for task in completed_tasks:
        if task.completedAt:
            try:
                completed = datetime.fromisoformat(task.completedAt.replace('Z', '+00:00'))
                day_name = completed.strftime('%A')
                day_completion[day_name] = day_completion.get(day_name, 0) + 1
            except:
                continue
    
    return {
        "overall_completion_rate": len(completed_tasks) / len(tasks) * 100,
        "department_performance": dept_stats,
        "average_completion_time_days": round(avg_completion_time, 1),
        "most_productive_days": sorted(day_completion.items(), key=lambda x: x[1], reverse=True)[:3],
        "total_completed": len(completed_tasks),
        "total_tasks": len(tasks)
    }


def identify_bottlenecks(tasks: List[TaskData]) -> Dict[str, Any]:
    """Identify workflow bottlenecks and problem areas."""
    
    # Tasks stuck in each status
    status_counts = {}
    old_tasks = {}
    
    for task in tasks:
        status_counts[task.status] = status_counts.get(task.status, 0) + 1
        
        # Identify old tasks (older than 7 days and not completed)
        if task.status not in ['completed', 'cancelled']:
            try:
                created = datetime.fromisoformat(task.createdAt.replace('Z', '+00:00'))
                days_old = (datetime.now() - created).days
                if days_old > 7:
                    if task.status not in old_tasks:
                        old_tasks[task.status] = []
                    old_tasks[task.status].append({
                        "id": task.id,
                        "title": task.title,
                        "days_old": days_old,
                        "assigned_to": task.assignedToName
                    })
            except:
                continue
    
    # High priority tasks that are stuck
    high_priority_stuck = []
    for task in tasks:
        if task.priority in ['high', 'urgent'] and task.status not in ['completed', 'cancelled']:
            try:
                created = datetime.fromisoformat(task.createdAt.replace('Z', '+00:00'))
                days_old = (datetime.now() - created).days
                if days_old > 3:
                    high_priority_stuck.append({
                        "id": task.id,
                        "title": task.title,
                        "priority": task.priority,
                        "days_old": days_old,
                        "status": task.status,
                        "assigned_to": task.assignedToName
                    })
            except:
                continue
    
    # Tasks with many dependencies
    high_dependency_tasks = [task for task in tasks if task.dependencyCount and task.dependencyCount > 2]
    
    return {
        "status_distribution": status_counts,
        "old_tasks_by_status": old_tasks,
        "high_priority_stuck": high_priority_stuck,
        "high_dependency_tasks": len(high_dependency_tasks),
        "bottleneck_status": max(status_counts.items(), key=lambda x: x[1])[0] if status_counts else None
    }


def generate_predictions(tasks: List[TaskData]) -> Dict[str, Any]:
    """Generate AI-powered predictions and forecasts."""
    
    completed_tasks = [t for t in tasks if t.status in ['completed', 'manager_approved', 'ai_approved']]
    pending_tasks = [t for t in tasks if t.status not in ['completed', 'cancelled']]
    
    if not completed_tasks:
        return {"message": "Insufficient data for predictions"}
    
    # Historical completion rates
    recent_completions = []
    for task in completed_tasks:
        if task.completedAt and task.createdAt:
            try:
                completed = datetime.fromisoformat(task.completedAt.replace('Z', '+00:00'))
                created = datetime.fromisoformat(task.createdAt.replace('Z', '+00:00'))
                recent_completions.append((completed - created).days)
            except:
                continue
    
    if not recent_completions:
        return {"message": "No valid completion data available"}
    
    avg_completion_time = sum(recent_completions) / len(recent_completions)
    
    # Predict completion dates for pending tasks
    predictions = []
    for task in pending_tasks[:10]:  # Limit to top 10
        try:
            created = datetime.fromisoformat(task.createdAt.replace('Z', '+00:00'))
            predicted_days = avg_completion_time * (1.2 if task.priority == 'low' else 1.0)
            predicted_completion = created + timedelta(days=predicted_days)
            
            predictions.append({
                "task_id": task.id,
                "title": task.title,
                "current_status": task.status,
                "predicted_completion_date": predicted_completion.isoformat(),
                "confidence": "medium" if predicted_days < 14 else "low"
            })
        except:
            continue
    
    # Workload prediction
    upcoming_due = []
    for task in pending_tasks:
        if task.dueDate:
            try:
                due = datetime.fromisoformat(task.dueDate.replace('Z', '+00:00'))
                if due > datetime.now():
                    upcoming_due.append(due)
            except:
                continue
    
    return {
        "average_completion_time_days": round(avg_completion_time, 1),
        "pending_task_predictions": predictions,
        "upcoming_deadlines_count": len([d for d in upcoming_due if (d - datetime.now()).days <= 7]),
        "workload_trend": "increasing" if len(upcoming_due) > len(completed_tasks) else "stable"
    }


def generate_recommendations(tasks: List[TaskData]) -> Dict[str, Any]:
    """Generate actionable recommendations based on task analysis."""
    
    recommendations = []
    
    # Analyze completion patterns
    completed_tasks = [t for t in tasks if t.status in ['completed', 'manager_approved', 'ai_approved']]
    overdue_tasks = []
    
    for task in tasks:
        if task.status not in ['completed', 'cancelled'] and task.dueDate:
            try:
                due = datetime.fromisoformat(task.dueDate.replace('Z', '+00:00'))
                if due < datetime.now():
                    overdue_tasks.append(task)
            except:
                continue
    
    # Generate specific recommendations
    if len(overdue_tasks) > len(tasks) * 0.2:
        recommendations.append({
            "type": "workload",
            "priority": "high",
            "title": "High Overdue Task Rate",
            "description": f"{len(overdue_tasks)} tasks are overdue. Consider redistributing workload or adjusting deadlines.",
            "action": "Review task assignments and deadlines"
        })
    
    # Check for tasks with too many dependencies
    high_dep_tasks = [t for t in tasks if t.dependencyCount and t.dependencyCount > 3]
    if high_dep_tasks:
        recommendations.append({
            "type": "dependencies",
            "priority": "medium",
            "title": "Complex Task Dependencies",
            "description": f"{len(high_dep_tasks)} tasks have more than 3 dependencies, which may cause delays.",
            "action": "Break down complex tasks into smaller subtasks"
        })
    
    # Department-specific recommendations
    dept_performance = {}
    for task in completed_tasks:
        dept = task.department or "Unassigned"
        if dept not in dept_performance:
            dept_performance[dept] = {"completed": 0, "total": 0}
        dept_performance[dept]["completed"] += 1
    
    for task in tasks:
        dept = task.department or "Unassigned"
        if dept not in dept_performance:
            dept_performance[dept] = {"completed": 0, "total": 0}
        dept_performance[dept]["total"] += 1
    
    for dept, stats in dept_performance.items():
        completion_rate = stats["completed"] / stats["total"] * 100 if stats["total"] > 0 else 0
        if completion_rate < 50 and stats["total"] > 5:
            recommendations.append({
                "type": "department",
                "priority": "medium",
                "title": f"Low Completion Rate in {dept}",
                "description": f"Only {completion_rate:.1f}% of tasks in {dept} are completed.",
                "action": "Provide additional resources or training for this department"
            })
    
    return {
        "recommendations": recommendations[:5],  # Limit to top 5
        "total_recommendations": len(recommendations)
    }


@app.post("/api/insights", response_model=InsightResponse)
async def generate_insights(request: InsightRequest):
    """Generate AI-powered insights from task data."""
    logger.info(f"Generating insights for {len(request.tasks)} tasks")
    
    try:
        insights = {}
        
        if "productivity" in request.insightTypes:
            insights["productivity"] = analyze_productivity_patterns(request.tasks)
        
        if "bottlenecks" in request.insightTypes:
            insights["bottlenecks"] = identify_bottlenecks(request.tasks)
        
        if "predictions" in request.insightTypes:
            insights["predictions"] = generate_predictions(request.tasks)
        
        if "recommendations" in request.insightTypes:
            insights["recommendations"] = generate_recommendations(request.tasks)
        
        return InsightResponse(
            insights=insights,
            generatedAt=datetime.now().isoformat(),
            timeRange=request.timeRange,
            taskCount=len(request.tasks)
        )
        
    except Exception as e:
        logger.error(f"Insight generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
